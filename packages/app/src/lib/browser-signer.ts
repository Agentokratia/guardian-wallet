/**
 * Browser-side interactive DKLs23 signing for the User+Server path.
 *
 * Uses @silencelaboratories/dkls-wasm-ll-web (browser WASM build) to run
 * the user's side of the 2-of-3 threshold signing protocol. The server
 * runs its side via the /signers/:id/sign/* endpoints.
 *
 * The full private key is NEVER reconstructed -- signing is a distributed
 * computation between user share (browser) and server share.
 */

import init, { Keyshare, Message, SignSession } from '@silencelaboratories/dkls-wasm-ll-web';
import { api } from './api-client';
import { fromBase64, toBase64 } from './encoding';

let wasmReady: Promise<void> | null = null;

/** Ensure the WASM module is initialized (idempotent). */
function ensureWasmInit(): Promise<void> {
	if (!wasmReady) {
		wasmReady = init().then(() => undefined);
	}
	return wasmReady;
}

interface TransactionParams {
	to: string;
	value?: string;
	data?: string;
	chainId: number;
	gasLimit?: string;
	gasPrice?: string;
	maxFeePerGas?: string;
	maxPriorityFeePerGas?: string;
	nonce?: number;
}

interface SignResult {
	txHash: string;
	signature: { r: string; s: string; v: number };
}

interface SessionResponse {
	sessionId: string;
	serverFirstMessage: string;
	initialMessages?: string[];
	roundsRemaining: number;
}

interface RoundResponse {
	messages: string[];
	roundsRemaining: number;
	presigned: boolean;
	messageHash?: string;
}

function serializeMessage(msg: Message): Uint8Array {
	const payload = msg.payload;
	const buf = new Uint8Array(1 + 1 + 1 + 4 + payload.length);
	buf[0] = msg.from_id;
	buf[1] = msg.to_id !== undefined ? 1 : 0;
	buf[2] = msg.to_id ?? 0;
	const view = new DataView(buf.buffer);
	view.setUint32(3, payload.length, false);
	buf.set(payload, 7);
	return buf;
}

function deserializeMessage(bytes: Uint8Array): Message {
	if (bytes.length < 7) {
		throw new Error(`Message too short: ${String(bytes.length)} bytes`);
	}
	const from = bytes[0]!;
	const hasTo = bytes[1] === 1;
	const to = hasTo ? bytes[2] : undefined;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const payloadLen = view.getUint32(3, false);
	const payload = bytes.slice(7, 7 + payloadLen);
	return new Message(payload, from, to);
}

/**
 * Run interactive DKLs23 signing in the browser (User + Server path).
 *
 * Protocol:
 * 1. Create user SignSession from keyshare, send first message to server
 * 2. Exchange rounds with server via /sign/round until presigned
 * 3. Finalize: user calls lastMessage(hash), sends to server
 * 4. Server combines and broadcasts, returns txHash
 */
export async function browserInteractiveSign(
	userShareBytes: Uint8Array,
	signerId: string,
	transaction: TransactionParams,
): Promise<SignResult> {
	let userSession: SignSession | null = null;

	try {
		// Step 0: Ensure WASM is initialized
		await ensureWasmInit();

		// Step 1: Create user SignSession from keyshare
		const userKeyshare = Keyshare.fromBytes(userShareBytes);
		userSession = new SignSession(userKeyshare, 'm');

		// Step 2: Generate user's first message (broadcast)
		const userFirstMsg = userSession.createFirstMessage();
		const userFirstMsgBytes = serializeMessage(userFirstMsg);
		userFirstMsg.free();

		// Step 3: Send session creation request to server
		const sessionRes = await api.post<SessionResponse>(
			`/signers/${signerId}/sign/session`,
			{
				signerFirstMessage: toBase64(userFirstMsgBytes),
				transaction,
			},
		);
		const { sessionId } = sessionRes;

		// Step 4: Process server's first message (broadcast)
		const serverFirstMsg = deserializeMessage(fromBase64(sessionRes.serverFirstMessage));
		let outgoing = userSession.handleMessages([serverFirstMsg]);
		try { serverFirstMsg.free(); } catch { /* already consumed */ }

		// Step 4b: Process server's round 1 output (initialMessages from createSession)
		if (sessionRes.initialMessages && sessionRes.initialMessages.length > 0) {
			const userR1 = outgoing;
			const serverR1Msgs = sessionRes.initialMessages.map((b64) => deserializeMessage(fromBase64(b64)));
			const userR2 = userSession.handleMessages(serverR1Msgs);
			for (const msg of serverR1Msgs) {
				try { msg.free(); } catch { /* already consumed */ }
			}
			outgoing = [...userR1, ...userR2];
		}

		// Step 5: Exchange rounds until presigned — mirrors the CLI's
		// `while (!presigned)` loop.
		let presigned = false;
		let serverMessageHash: Uint8Array | undefined;
		while (!presigned) {
			// Serialize outgoing messages
			const outgoingBase64 = outgoing.map((msg) => {
				const bytes = serializeMessage(msg);
				try { msg.free(); } catch { /* already consumed */ }
				return toBase64(bytes);
			});

			// Send round to server
			const roundRes = await api.post<RoundResponse>(
				`/signers/${signerId}/sign/round`,
				{
					sessionId,
					messages: outgoingBase64,
				},
			);

			presigned = roundRes.presigned;

			// Capture the server-computed messageHash when presigning completes
			if (roundRes.messageHash) {
				serverMessageHash = fromBase64(roundRes.messageHash);
			}

			// Process server messages one at a time (same as CLI).
			if (roundRes.messages.length > 0) {
				const allOutgoing: Message[] = [];
				for (let i = 0; i < roundRes.messages.length; i++) {
					const serverMsg = deserializeMessage(fromBase64(roundRes.messages[i]!));
					try {
						const out = userSession.handleMessages([serverMsg]);
						try { serverMsg.free(); } catch { /* already consumed */ }
						allOutgoing.push(...out);
					} catch {
						// Client already presigned — stop processing.
						try { serverMsg.free(); } catch { /* already consumed */ }
						presigned = true;
						break;
					}
				}
				outgoing = allOutgoing;
			}

			// If presigned, free remaining outgoing
			if (presigned) {
				for (const msg of outgoing) {
					try { msg.free(); } catch { /* already consumed */ }
				}
			}
		}

		if (!serverMessageHash) {
			throw new Error('Server did not return messageHash after presigning completed');
		}

		// Step 6: Finalization
		const userLastMsg = userSession.lastMessage(serverMessageHash);
		const userLastMsgBytes = serializeMessage(userLastMsg);
		userLastMsg.free();

		// Step 7: Send complete request to server
		const result = await api.post<SignResult>(
			`/signers/${signerId}/sign/complete`,
			{
				sessionId,
				lastMessage: toBase64(userLastMsgBytes),
				messageHash: toBase64(serverMessageHash),
			},
		);

		return result;
	} finally {
		// CRITICAL: Wipe share bytes from memory
		userShareBytes.fill(0);
		// Free the WASM SignSession to prevent memory leaks
		if (userSession) userSession.free();
	}
}
