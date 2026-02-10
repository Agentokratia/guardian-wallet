import { secp256k1 } from '@noble/curves/secp256k1.js';
import {
	KeygenSession,
	Keyshare,
	Message,
	SignSession,
} from '@silencelaboratories/dkls-wasm-ll-node';
import type {
	CurveName,
	DKGRoundResult,
	IThresholdScheme,
	SchemeName,
} from '@agentokratia/guardian-core';
import { getAddress, keccak256, toHex } from 'viem';

// ----- Message serialization helpers -----

interface SerializedMessage {
	readonly from_id: number;
	readonly to_id: number | null;
	readonly payload: string; // base64
}

function messageToBytes(msg: Message): Uint8Array {
	const obj: SerializedMessage = {
		from_id: msg.from_id,
		to_id: msg.to_id ?? null,
		payload: uint8ArrayToBase64(msg.payload),
	};
	return new TextEncoder().encode(JSON.stringify(obj));
}

function bytesToMessage(bytes: Uint8Array): Message {
	const text = new TextDecoder().decode(bytes);
	const obj = JSON.parse(text) as SerializedMessage;
	const payload = base64ToUint8Array(obj.payload);
	return new Message(payload, obj.from_id, obj.to_id ?? undefined);
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64');
}

function base64ToUint8Array(b64: string): Uint8Array {
	return new Uint8Array(Buffer.from(b64, 'base64'));
}

function generateSeed(): Uint8Array {
	const seed = new Uint8Array(32);
	crypto.getRandomValues(seed);
	return seed;
}

function getSession(sessions: KeygenSession[], index: number): KeygenSession {
	const session = sessions[index];
	if (!session) {
		throw new Error(`Missing keygen session at index ${String(index)}`);
	}
	return session;
}

/**
 * Safely free a WASM Message. No-op if already freed.
 */
function safeFree(msg: Message): void {
	try {
		msg.free();
	} catch {
		// Already freed by WASM ownership transfer
	}
}

const SESSION_TTL_MS = 60_000;

// ----- DKG session state -----

interface DKGSessionState {
	sessions: KeygenSession[];
	round: number;
	createdAt: number;
}

// ----- Sign session state -----

interface SignParty {
	session: SignSession;
	partyId: number;
}

interface SignSessionState {
	parties: SignParty[];
	publicKey: Uint8Array;
	round: number;
	presigned: boolean;
	createdAt: number;
}

/**
 * DKLs23 threshold scheme backed by @silencelaboratories/dkls-wasm-ll-node.
 *
 * Implements a 2-of-3 threshold ECDSA scheme where the full private key
 * NEVER exists in any single location.
 *
 * The DKG and signing protocols are interactive multi-round protocols.
 * The IThresholdScheme.partialSign/aggregate methods throw because this
 * protocol uses interactive signing sessions instead.
 *
 * IMPORTANT: The WASM handleMessages/combine functions take ownership of
 * Message objects (zeroing their pointers). Messages must be cloned before
 * passing to these functions when they may be reused across parties.
 */
export class DKLs23Scheme implements IThresholdScheme {
	readonly name: SchemeName = 'dkls23' as SchemeName;
	readonly curve: CurveName = 'secp256k1' as CurveName;

	private readonly dkgSessions = new Map<string, DKGSessionState>();
	private readonly signSessions = new Map<string, SignSessionState>();

	// ---- Session cleanup ----

	private cleanupExpiredSessions(): void {
		const now = Date.now();
		for (const [id, state] of this.dkgSessions) {
			if (now - state.createdAt > SESSION_TTL_MS) {
				this.dkgSessions.delete(id);
			}
		}
		for (const [id, state] of this.signSessions) {
			if (now - state.createdAt > SESSION_TTL_MS) {
				this.signSessions.delete(id);
			}
		}
	}

	// ---- IThresholdScheme: DKG ----

	async dkg(sessionId: string, round: number, incoming: Uint8Array[]): Promise<DKGRoundResult> {
		this.cleanupExpiredSessions();
		const PARTICIPANTS = 3;
		const THRESHOLD = 2;

		if (round < 1 || round > 5) {
			throw new Error(`Invalid DKG round: ${round}. Must be 1-5.`);
		}

		// Round 1: create sessions for all 3 parties
		if (round === 1) {
			const sessions: KeygenSession[] = [];
			for (let partyId = 0; partyId < PARTICIPANTS; partyId++) {
				sessions.push(new KeygenSession(PARTICIPANTS, THRESHOLD, partyId, generateSeed()));
			}
			this.dkgSessions.set(sessionId, { sessions, round: 1, createdAt: Date.now() });

			// Each party creates its first message (broadcast)
			const outgoing: Uint8Array[] = [];
			for (const session of sessions) {
				const firstMsg = session.createFirstMessage();
				outgoing.push(messageToBytes(firstMsg));
				firstMsg.free();
			}

			return { outgoing, finished: false };
		}

		const state = this.dkgSessions.get(sessionId);
		if (!state) {
			throw new Error(`No DKG session found for id: ${sessionId}`);
		}

		const { sessions } = state;
		state.round = round;

		// Deserialize incoming messages
		const incomingMessages = incoming.map(bytesToMessage);

		try {
			if (round === 2) {
				// Round 2: handleMessages(broadcast msgs) -> P2P messages + commitments
				const outgoing: Uint8Array[] = [];
				const commitments: Uint8Array[] = [];

				for (let partyId = 0; partyId < PARTICIPANTS; partyId++) {
					const session = getSession(sessions, partyId);
					// Clone messages — handleMessages takes ownership (zeroes pointers)
					const msgsForParty = incomingMessages
						.filter((m) => m.from_id !== partyId)
						.map((m) => m.clone());
					const resultMsgs = session.handleMessages(msgsForParty, undefined, generateSeed());
					for (const msg of resultMsgs) {
						outgoing.push(messageToBytes(msg));
						msg.free();
					}
					const commitment = session.calculateChainCodeCommitment();
					commitments.push(commitment);
				}

				// Store commitments on the state for round 4
				(state as DKGSessionState & { commitments?: Uint8Array[] }).commitments = commitments;

				return { outgoing, finished: false };
			}

			if (round === 3) {
				// Round 3: handleMessages(P2P msgs for this party) -> P2P messages
				const outgoing: Uint8Array[] = [];

				for (let partyId = 0; partyId < PARTICIPANTS; partyId++) {
					const session = getSession(sessions, partyId);
					// Clone messages — handleMessages takes ownership
					const msgsForParty = incomingMessages
						.filter((m) => m.to_id === partyId)
						.map((m) => m.clone());
					const resultMsgs = session.handleMessages(msgsForParty, undefined, generateSeed());
					for (const msg of resultMsgs) {
						outgoing.push(messageToBytes(msg));
						msg.free();
					}
				}

				return { outgoing, finished: false };
			}

			if (round === 4) {
				// Round 4: handleMessages(P2P msgs, commitments) -> broadcast messages
				const outgoing: Uint8Array[] = [];
				const commitments = (state as DKGSessionState & { commitments?: Uint8Array[] }).commitments;

				for (let partyId = 0; partyId < PARTICIPANTS; partyId++) {
					const session = getSession(sessions, partyId);
					// Clone messages — handleMessages takes ownership
					const msgsForParty = incomingMessages
						.filter((m) => m.to_id === partyId)
						.map((m) => m.clone());
					const resultMsgs = session.handleMessages(msgsForParty, commitments, generateSeed());
					for (const msg of resultMsgs) {
						outgoing.push(messageToBytes(msg));
						msg.free();
					}
				}

				return { outgoing, finished: false };
			}

			// Round 5: handleMessages(broadcast msgs) -> done, extract keyshares
			const keyshares: Keyshare[] = [];

			for (let partyId = 0; partyId < PARTICIPANTS; partyId++) {
				const session = getSession(sessions, partyId);
				// Clone messages — handleMessages takes ownership
				const msgsForParty = incomingMessages
					.filter((m) => m.from_id !== partyId)
					.map((m) => m.clone());
				session.handleMessages(msgsForParty, undefined, generateSeed());
				keyshares.push(session.keyshare()); // consumes session
			}

			// Extract public key (33-byte compressed secp256k1)
			const firstKeyshare = keyshares[0];
			if (!firstKeyshare) {
				throw new Error('DKG produced no keyshares');
			}
			const publicKey = new Uint8Array(firstKeyshare.publicKey);

			// Serialize shares (Keyshare.toBytes())
			const shares: Uint8Array[] = keyshares.map((ks) => ks.toBytes());

			// Clean up
			this.dkgSessions.delete(sessionId);

			return {
				outgoing: [],
				finished: true,
				publicKey,
				shares,
			};
		} finally {
			// Free original incoming messages (clones were consumed by handleMessages)
			for (const msg of incomingMessages) {
				safeFree(msg);
			}
		}
	}

	// ---- IThresholdScheme: Address derivation ----

	deriveAddress(publicKey: Uint8Array): string {
		// Decompress 33-byte compressed secp256k1 key to get (x, y)
		let uncompressedNoPrefix: Uint8Array;

		if (publicKey.length === 33) {
			// Decompress using @noble/curves v2
			const point = secp256k1.Point.fromBytes(publicKey);
			const uncompressed = point.toBytes(false); // 65 bytes: 0x04 + x + y
			uncompressedNoPrefix = uncompressed.slice(1); // 64 bytes: x + y
		} else if (publicKey.length === 65) {
			uncompressedNoPrefix = publicKey.slice(1); // strip 0x04 prefix
		} else {
			throw new Error(`Invalid public key length: ${String(publicKey.length)}. Expected 33 or 65.`);
		}

		// keccak256(x || y) -> last 20 bytes = Ethereum address
		const hash = keccak256(toHex(uncompressedNoPrefix));
		const addressHex = `0x${hash.slice(-40)}` as `0x${string}`;
		return getAddress(addressHex);
	}

	// ---- IThresholdScheme: Interactive signing ----

	/**
	 * Creates a new interactive signing session for 2 participating parties.
	 * Each entry in keyshareBytes is a serialized Keyshare (Keyshare.toBytes()).
	 *
	 * @returns sessionId and first-round broadcast messages
	 */
	createSignSession(keyshareBytes: Uint8Array[]): {
		sessionId: string;
		firstMessages: Uint8Array[];
	} {
		this.cleanupExpiredSessions();
		if (keyshareBytes.length < 2) {
			throw new Error(`Need at least 2 keyshares for signing, got ${String(keyshareBytes.length)}`);
		}

		const sessionId = crypto.randomUUID();
		const parties: SignParty[] = [];
		const firstMessages: Uint8Array[] = [];

		// Extract the public key from the first keyshare (all shares have the same one)
		const firstKs = Keyshare.fromBytes(keyshareBytes[0]!);
		const publicKey = new Uint8Array(firstKs.publicKey);
		firstKs.free();

		for (const ksBytes of keyshareBytes) {
			const keyshare = Keyshare.fromBytes(ksBytes);
			const partyId = keyshare.partyId;
			const session = new SignSession(keyshare, 'm', generateSeed());
			const firstMsg = session.createFirstMessage();
			firstMessages.push(messageToBytes(firstMsg));
			firstMsg.free();
			parties.push({ session, partyId });
		}

		this.signSessions.set(sessionId, {
			parties,
			publicKey,
			round: 1,
			presigned: false,
			createdAt: Date.now(),
		});

		return { sessionId, firstMessages };
	}

	/**
	 * Processes one round of the interactive signing protocol.
	 * Incoming messages should be the serialized Message objects from the previous round.
	 *
	 * @returns outgoing messages and whether presigning is complete
	 */
	processSignRound(
		sessionId: string,
		incomingMessages: Uint8Array[],
	): {
		outgoingMessages: Uint8Array[];
		presigned: boolean;
	} {
		const state = this.signSessions.get(sessionId);
		if (!state) {
			throw new Error(`No sign session found for id: ${sessionId}`);
		}

		const { parties } = state;
		state.round++;

		const incoming = incomingMessages.map(bytesToMessage);
		const outgoing: Uint8Array[] = [];

		try {
			for (const party of parties) {
				// Clone messages — handleMessages takes ownership (zeroes pointers)
				const msgsForParty = incoming
					.filter(
						(m) =>
							m.to_id === party.partyId ||
							(m.to_id === undefined && m.from_id !== party.partyId),
					)
					.map((m) => m.clone());
				const resultMsgs = party.session.handleMessages(msgsForParty, generateSeed());
				for (const msg of resultMsgs) {
					outgoing.push(messageToBytes(msg));
					msg.free();
				}
			}

			// After round 4, presigning is complete
			if (state.round >= 4) {
				state.presigned = true;
			}

			return { outgoingMessages: outgoing, presigned: state.presigned };
		} finally {
			// Free original incoming messages (clones were consumed by handleMessages)
			for (const msg of incoming) {
				safeFree(msg);
			}
		}
	}

	/**
	 * Finalizes a presigned signing session with the actual message hash.
	 *
	 * @param sessionId - The signing session ID
	 * @param messageHash - 32-byte hash to sign
	 * @param incomingLastMessages - Last-round messages from processSignRound (if any remain)
	 * @returns r, s components and recovery v value
	 */
	finalizeSign(
		sessionId: string,
		messageHash: Uint8Array,
		incomingLastMessages: Uint8Array[],
	): {
		r: Uint8Array;
		s: Uint8Array;
		v: number;
	} {
		const state = this.signSessions.get(sessionId);
		if (!state) {
			throw new Error(`No sign session found for id: ${sessionId}`);
		}
		if (!state.presigned) {
			throw new Error('Session is not yet presigned. Complete all signing rounds first.');
		}

		const { parties } = state;
		const firstParty = parties[0];
		if (!firstParty) {
			throw new Error('Sign session has no parties');
		}

		// Get the expected public key from the first party's keyshare
		const expectedPublicKey = state.publicKey;

		try {
			// Each party calls lastMessage(messageHash) to produce a broadcast message
			const lastMessages: Message[] = [];
			for (const party of parties) {
				const lastMsg = party.session.lastMessage(messageHash);
				lastMessages.push(lastMsg);
			}

			// Deserialize any externally-provided last messages
			const externalLast = incomingLastMessages.map(bytesToMessage);
			const allLastMessages = [...lastMessages, ...externalLast];

			// First party combines: receives the OTHER party's last message
			// Clone because combine takes ownership
			const msgsForFirst = allLastMessages
				.filter((m) => m.from_id !== firstParty.partyId)
				.map((m) => m.clone());
			// combine() consumes the session and returns [R, S] as Array<any>
			const result = firstParty.session.combine(msgsForFirst) as [Uint8Array, Uint8Array];
			const rBytes = result[0];
			const sBytes = result[1];

			// Compute v (recovery id): try v=27 and v=28
			const r = new Uint8Array(rBytes);
			const s = new Uint8Array(sBytes);
			const v = this.computeRecoveryId(r, s, messageHash, expectedPublicKey);

			// Free remaining messages
			for (const msg of allLastMessages) {
				safeFree(msg);
			}

			return { r, s, v };
		} finally {
			// Clean up session from the map
			this.signSessions.delete(sessionId);
		}
	}

	// ---- Internal helpers ----

	/**
	 * Computes the Ethereum signature recovery ID (v = 27 or 28).
	 * Tries both recovery bits and returns the one whose recovered
	 * public key matches the expected DKG public key.
	 */
	private computeRecoveryId(
		r: Uint8Array,
		s: Uint8Array,
		messageHash: Uint8Array,
		expectedPublicKey: Uint8Array,
	): number {
		const rBig = BigInt(`0x${Buffer.from(r).toString('hex')}`);
		const sBig = BigInt(`0x${Buffer.from(s).toString('hex')}`);
		const expectedHex = toHex(expectedPublicKey);

		for (const recoveryBit of [0, 1] as const) {
			try {
				const sig = new secp256k1.Signature(rBig, sBig).addRecoveryBit(recoveryBit);
				const recovered = sig.recoverPublicKey(messageHash);
				const recoveredHex = toHex(recovered.toBytes(true));
				if (recoveredHex === expectedHex) {
					return recoveryBit + 27;
				}
			} catch {
				// Try next recovery bit
			}
		}

		throw new Error(
			'Failed to compute recovery ID: neither v=27 nor v=28 recovers the expected public key',
		);
	}
}
