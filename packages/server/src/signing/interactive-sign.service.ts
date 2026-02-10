import { randomUUID } from 'node:crypto';
import {
	ForbiddenException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
	OnModuleDestroy,
} from '@nestjs/common';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import type {
	IChain,
	IPolicyEngine,
	IRulesEngine,
	IVaultStore,
	PolicyContext,
	TransactionRequest,
} from '@agentokratia/guardian-core';
import { RequestStatus, RequestType, SigningPath } from '@agentokratia/guardian-core';
import { Keyshare, Message, SignSession } from '@silencelaboratories/dkls-wasm-ll-node';
import { hexToBytes, keccak256, toHex } from 'viem';
import { SigningRequestRepository } from '../audit/signing-request.repository.js';
import { ChainRegistryService } from '../common/chain.module.js';
import { wipeBuffer } from '../common/crypto-utils.js';
import { VAULT_STORE } from '../common/vault.module.js';
import { PolicyDocumentRepository } from '../policies/policy-document.repository.js';
import { PolicyRepository } from '../policies/policy.repository.js';
import { SignerRepository } from '../signers/signer.repository.js';

const SESSION_TTL_MS = 60_000;
const CLEANUP_INTERVAL_MS = 10_000;
const MAX_MESSAGE_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10 MB — DKLs23 messages are small, this is a safety cap
const MAX_CONCURRENT_SESSIONS = 1_000;

interface BaseSessionState {
	readonly signerId: string;
	readonly ethAddress: string;
	readonly ownerAddress: string;
	readonly expectedPublicKey: Uint8Array;
	readonly signingPath: SigningPath;
	readonly serverKeyshareBytes: Uint8Array;
	readonly policyResult: { evaluatedCount: number; evaluationTimeMs: number };
	round: number;
	readonly createdAt: number;
	serverSessionBytes: Uint8Array;
	/** Live WASM SignSession — kept in memory for presigned sessions to avoid
	 *  serialization issues with toBytes()/fromBytes() during combine(). */
	liveSession?: SignSession;
}

interface TxSessionState extends BaseSessionState {
	readonly type: 'tx';
	readonly transaction: TransactionRequest;
	readonly decodedTo: string;
	readonly decodedFunctionName: string | undefined;
}

interface MessageSessionState extends BaseSessionState {
	readonly type: 'message';
}

type SignSessionState = TxSessionState | MessageSessionState;

export interface CreateSessionInput {
	readonly signerId: string;
	readonly signerFirstMessage: Uint8Array;
	readonly transaction: TransactionRequest;
	readonly signingPath?: SigningPath;
	readonly callerIp?: string;
}

export interface CreateSessionOutput {
	readonly sessionId: string;
	readonly serverFirstMessage: Uint8Array;
	readonly initialRoundMessages: Uint8Array[];
	readonly roundsRemaining: number;
}

export interface ProcessRoundInput {
	readonly sessionId: string;
	readonly signerId: string;
	readonly incomingMessages: Uint8Array[];
}

export interface ProcessRoundOutput {
	readonly outgoingMessages: Uint8Array[];
	readonly roundsRemaining: number;
	readonly presigned: boolean;
	readonly messageHash?: Uint8Array;
}

export interface CompleteSignInput {
	readonly sessionId: string;
	readonly signerId: string;
	readonly lastMessage: Uint8Array;
	readonly messageHash: Uint8Array;
}

export interface CompleteSignOutput {
	readonly txHash: string;
	readonly signature: { r: string; s: string; v: number };
}

export interface CreateMessageSessionInput {
	readonly signerId: string;
	readonly signerFirstMessage: Uint8Array;
	readonly signingPath?: SigningPath;
	readonly callerIp?: string;
}

export interface CompleteMessageSignOutput {
	readonly signature: { r: string; s: string; v: number };
}

// DKLs23 message wire format: [from:u8][hasTo:u8][to:u8][payloadLen:u32BE][payload]
const MSG_HEADER_SIZE = 7;

function serializeMessage(msg: Message): Uint8Array {
	const payload = msg.payload;
	const buf = new Uint8Array(MSG_HEADER_SIZE + payload.length);
	buf[0] = msg.from_id;
	buf[1] = msg.to_id !== undefined ? 1 : 0;
	buf[2] = msg.to_id ?? 0;
	const view = new DataView(buf.buffer);
	view.setUint32(3, payload.length, false);
	buf.set(payload, MSG_HEADER_SIZE);
	return buf;
}

function deserializeMessage(bytes: Uint8Array): Message {
	if (bytes.length < MSG_HEADER_SIZE) {
		throw new Error(`Message too short: expected at least ${MSG_HEADER_SIZE} bytes, got ${bytes.length}`);
	}
	const from = bytes[0]!;
	const hasTo = bytes[1] === 1;
	const to = hasTo ? bytes[2] : undefined;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const payloadLen = view.getUint32(3, false);
	if (payloadLen > MAX_MESSAGE_PAYLOAD_BYTES) {
		throw new Error(`Message payload length ${payloadLen} exceeds maximum ${MAX_MESSAGE_PAYLOAD_BYTES}`);
	}
	if (payloadLen > bytes.length - MSG_HEADER_SIZE) {
		throw new Error(
			`Message payload length ${payloadLen} exceeds available data (${bytes.length - MSG_HEADER_SIZE} bytes)`,
		);
	}
	const payload = bytes.slice(MSG_HEADER_SIZE, MSG_HEADER_SIZE + payloadLen);
	return new Message(payload, from, to);
}

@Injectable()
export class InteractiveSignService implements OnModuleDestroy {
	private readonly logger = new Logger(InteractiveSignService.name);
	private readonly sessions = new Map<string, SignSessionState>();
	private readonly cleanupTimer: ReturnType<typeof setInterval>;

	constructor(
		@Inject(SignerRepository) private readonly signerRepo: SignerRepository,
		@Inject(SigningRequestRepository) private readonly signingRequestRepo: SigningRequestRepository,
		@Inject(PolicyRepository) private readonly policyRepo: PolicyRepository,
		@Inject('POLICY_ENGINE') private readonly policyEngine: IPolicyEngine,
		@Inject('RULES_ENGINE') private readonly rulesEngine: IRulesEngine,
		@Inject(PolicyDocumentRepository) private readonly policyDocRepo: PolicyDocumentRepository,
		@Inject(ChainRegistryService) private readonly chainRegistry: ChainRegistryService,
		@Inject(VAULT_STORE) private readonly vault: IVaultStore,
	) {
		this.cleanupTimer = setInterval(() => this.cleanupExpiredSessions(), CLEANUP_INTERVAL_MS);
	}

	onModuleDestroy(): void {
		clearInterval(this.cleanupTimer);
		for (const [id, state] of this.sessions) {
			wipeBuffer(state.serverKeyshareBytes);
			wipeBuffer(state.serverSessionBytes);
			this.sessions.delete(id);
		}
	}

	async createSession(input: CreateSessionInput): Promise<CreateSessionOutput> {
		if (this.sessions.size >= MAX_CONCURRENT_SESSIONS) {
			throw new ForbiddenException('Too many concurrent signing sessions. Try again later.');
		}
		const signingPath = input.signingPath ?? SigningPath.SIGNER_SERVER;

		// Step 1: Verify signer
		const signer = await this.signerRepo.findById(input.signerId);
		if (!signer) {
			throw new NotFoundException('Signer not found');
		}
		if (signer.status !== 'active') {
			throw new ForbiddenException(`Signer is ${signer.status}`);
		}

		// Step 2: Resolve chain from transaction chainId
		if (!input.transaction.chainId || input.transaction.chainId === 0) {
			throw new ForbiddenException('chainId is required in transaction');
		}
		const chain = await this.chainRegistry.getChain(input.transaction.chainId);

		// Step 2b: Auto-populate missing transaction fields (nonce, gas)
		const populatedTx = await this.populateTransaction(input.transaction, signer.ethAddress, chain);

		// Step 2c: Decode transaction
		const txBytes = await chain.buildTransaction(populatedTx);
		const decoded = chain.decodeTransaction(txBytes);

		// Step 3: Build policy context
		const now = new Date();
		const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
		const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
		const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

		const [rollingDailySpend, rollingMonthlySpend, requestsLastHour, requestsToday] =
			await Promise.all([
				this.signingRequestRepo.sumValueBySignerInWindow(signer.id, dayAgo),
				this.signingRequestRepo.sumValueBySignerInWindow(signer.id, monthAgo),
				this.signingRequestRepo.countBySignerInWindow(signer.id, hourAgo),
				this.signingRequestRepo.countBySignerInWindow(signer.id, dayAgo),
			]);

		const policyContext: PolicyContext = {
			signerAddress: signer.ethAddress,
			toAddress: decoded.to,
			valueWei: populatedTx.value ?? 0n,
			functionSelector: decoded.functionSelector,
			chainId: populatedTx.chainId,
			rollingDailySpendWei: rollingDailySpend,
			rollingMonthlySpendWei: rollingMonthlySpend,
			requestCountLastHour: requestsLastHour,
			requestCountToday: requestsToday,
			currentHourUtc: now.getUTCHours(),
			timestamp: now,
			txData: populatedTx.data ? toHex(populatedTx.data) : undefined,
			callerIp: input.callerIp,
		};

		// Step 4: Evaluate policies — try rules engine first, fall back to legacy
		const policyDoc = await this.policyDocRepo.findBySigner(signer.id);
		let policyResult;

		if (policyDoc) {
			policyResult = await this.rulesEngine.evaluate(policyDoc, policyContext);
		} else {
			// Legacy path: old per-policy evaluation
			const enabledPolicies = await this.policyRepo.findEnabledBySigner(signer.id);
			policyResult = await this.policyEngine.evaluate(
				enabledPolicies.map((p) => ({
					id: p.id,
					type: p.type,
					config: p.config as unknown as Record<string, unknown>,
					enabled: p.enabled,
				})),
				policyContext,
			);
		}

		// Step 5: If blocked, log and throw
		if (!policyResult.allowed) {
			await this.signingRequestRepo.create({
				signerId: signer.id,
				ownerAddress: signer.ownerAddress,
				requestType: RequestType.SIGN_TX,
				signingPath,
				status: RequestStatus.BLOCKED,
				toAddress: decoded.to,
				valueWei: populatedTx.value?.toString(),
				chainId: populatedTx.chainId,
				decodedAction: decoded.functionName,
				policyViolations: policyResult.violations as unknown as Record<string, unknown>[],
				policiesEvaluated: policyResult.evaluatedCount,
				evaluationTimeMs: policyResult.evaluationTimeMs,
			}).catch((err) => this.logger.error(`Failed to write blocked audit log: ${err}`));

			throw new ForbiddenException({
				message: 'Transaction blocked by policy',
				violations: policyResult.violations.map(({ type, reason }) => ({ type, reason })),
			});
		}

		// Step 6: Fetch server keyshare from Vault
		let serverKeyshareBytes: Uint8Array | null = null;
		let serverSession: SignSession | null = null;
		try {
			serverKeyshareBytes = await this.vault.getShare(signer.vaultSharePath);

			// Step 7: Create server SignSession from keyshare
			const serverKeyshare = Keyshare.fromBytes(serverKeyshareBytes);
			// Extract public key before keyshare is consumed by SignSession constructor
			const expectedPublicKey = new Uint8Array(serverKeyshare.publicKey);
			serverSession = new SignSession(serverKeyshare, 'm');

			// Step 8: Get server first message (broadcast)
			const serverFirstMsg = serverSession.createFirstMessage();
			const serverFirstMsgBytes = serializeMessage(serverFirstMsg);
			serverFirstMsg.free();

			// Step 9: Process signer's first message (broadcast) immediately
			// so the server advances to round 1 during session creation.
			const signerFirstMsg = deserializeMessage(input.signerFirstMessage);
			const serverRound1Msgs = serverSession.handleMessages([signerFirstMsg]);
			try { signerFirstMsg.free(); } catch { /* already consumed */ }

			// Serialize the round 1 output to return alongside serverFirstMessage
			const round1Bytes: Uint8Array[] = [];
			for (const msg of serverRound1Msgs) {
				round1Bytes.push(serializeMessage(msg));
				try { msg.free(); } catch { /* already consumed */ }
			}

			// Step 10: Serialize server session (now at round 1) for storage
			const serverSessionBytes = serverSession.toBytes();
			try { serverSession.free(); } catch { /* may be consumed */ }
			serverSession = null; // ownership transferred to serialized bytes

			// Step 11: Store session state
			const sessionId = randomUUID();
			this.sessions.set(sessionId, {
				type: 'tx',
				signerId: signer.id,
				ethAddress: signer.ethAddress,
				ownerAddress: signer.ownerAddress,
				expectedPublicKey,
				signingPath,
				serverKeyshareBytes,
				transaction: populatedTx,
				decodedTo: decoded.to,
				decodedFunctionName: decoded.functionName,
				policyResult: {
					evaluatedCount: policyResult.evaluatedCount,
					evaluationTimeMs: policyResult.evaluationTimeMs,
				},
				round: 1,
				createdAt: Date.now(),
				serverSessionBytes,
			});

			return {
				sessionId,
				serverFirstMessage: serverFirstMsgBytes,
				initialRoundMessages: round1Bytes,
				roundsRemaining: 3,
			};
		} catch (error) {
			// Free WASM session if it wasn't serialized yet
			if (serverSession) {
				try { serverSession.free(); } catch { /* may be consumed */ }
			}
			// Wipe keyshare bytes if session creation failed
			if (serverKeyshareBytes) {
				wipeBuffer(serverKeyshareBytes);
			}
			if (!(error instanceof ForbiddenException) && !(error instanceof NotFoundException)) {
				await this.signingRequestRepo.create({
					signerId: signer.id,
					ownerAddress: signer.ownerAddress,
					requestType: RequestType.SIGN_TX,
					signingPath,
					status: RequestStatus.FAILED,
					toAddress: decoded.to,
					valueWei: populatedTx.value?.toString(),
					chainId: populatedTx.chainId,
					decodedAction: decoded.functionName,
					policiesEvaluated: policyResult.evaluatedCount,
					evaluationTimeMs: policyResult.evaluationTimeMs,
				});
			}
			throw error;
		}
	}

	async processRound(input: ProcessRoundInput): Promise<ProcessRoundOutput> {
		const state = this.getValidSession(input.sessionId);
		if (state.signerId !== input.signerId) {
			throw new ForbiddenException('Session does not belong to this signer');
		}

		// Re-check signer status — reject if paused/revoked since session creation
		const signer = await this.signerRepo.findById(state.signerId);
		if (!signer || signer.status !== 'active') {
			this.destroySession(input.sessionId);
			throw new ForbiddenException(`Signer is ${signer?.status ?? 'deleted'}`);
		}

		// Deserialize server SignSession from stored bytes
		const serverSession = SignSession.fromBytes(state.serverSessionBytes);
		try {
			const allOutgoingBytes: Uint8Array[] = [];
			let lastRoundOutputCount = 0;

			// Process each incoming message sequentially — this supports
			// multi-message batches (e.g. when client sends signerR1 + signerR2
			// after processing both serverBroadcast and initialRoundMessages).
			// IMPORTANT: stop as soon as presigning is detected (output is empty)
			// because calling handleMessages on a presigned session throws
			// "invalid state". This matters for the User+Server path (party 2+1)
			// where presigning can complete on the first message of a batch.
			for (const incomingBytes of input.incomingMessages) {
				const msg = deserializeMessage(incomingBytes);
				const outgoing = serverSession.handleMessages([msg]);
				try { msg.free(); } catch { /* already consumed */ }

				lastRoundOutputCount = outgoing.length;
				for (const outMsg of outgoing) {
					allOutgoingBytes.push(serializeMessage(outMsg));
					try { outMsg.free(); } catch { /* already consumed */ }
				}

				state.round += 1;

				// Presigning detected — the session can no longer accept messages.
				if (outgoing.length === 0) break;
			}

			// Detect presigning completion: the DKLs23 protocol is presigned
			// when the last handleMessages call produces 0 outgoing messages,
			// meaning both parties have computed their presignature shares.
			const presigned = input.incomingMessages.length > 0 && lastRoundOutputCount === 0;
			const roundsRemaining = presigned ? 0 : Math.max(1, 4 - state.round);

			if (presigned) {
				// Keep the live WASM session in memory — toBytes()/fromBytes()
				// can lose internal state needed for lastMessage() + combine().
				state.liveSession = serverSession;
			} else {
				// Not presigned yet — serialize session for next round
				state.serverSessionBytes = serverSession.toBytes();
				try { serverSession.free(); } catch { /* may be consumed */ }
			}

			// When presigning is complete, compute the canonical messageHash
			// so the client can use it in lastMessage(). For transactions the
			// hash is keccak256(serialized unsigned tx). For messages the
			// client provides its own hash via completeMessageSign.
			let messageHash: Uint8Array | undefined;
			if (presigned && state.type === 'tx') {
				const chain = await this.chainRegistry.getChain(state.transaction.chainId);
				const txBytes = await chain.buildTransaction(state.transaction);
				messageHash = new Uint8Array(
					hexToBytes(keccak256(toHex(txBytes))),
				);
			}

			return {
				outgoingMessages: allOutgoingBytes,
				roundsRemaining,
				presigned,
				messageHash,
			};
		} catch (error) {
			// On error during round processing, clean up the session
			try { serverSession.free(); } catch { /* may be consumed */ }
			this.destroySession(input.sessionId);
			throw error;
		}
	}

	async completeSign(input: CompleteSignInput): Promise<CompleteSignOutput> {
		const state = this.getValidSession(input.sessionId);
		if (state.signerId !== input.signerId) {
			throw new ForbiddenException('Session does not belong to this signer');
		}
		if (state.type !== 'tx') {
			throw new ForbiddenException('Session is not a transaction session. Use /sign-message/complete instead.');
		}

		// Re-check signer status — reject if paused/revoked since session creation
		const signer = await this.signerRepo.findById(state.signerId);
		if (!signer || signer.status !== 'active') {
			this.destroySession(input.sessionId);
			throw new ForbiddenException(`Signer is ${signer?.status ?? 'deleted'}`);
		}

		// Use live session from processRound (avoids toBytes/fromBytes corruption)
		// or fall back to deserializing from stored bytes
		const serverSession = state.liveSession ?? SignSession.fromBytes(state.serverSessionBytes);
		state.liveSession = undefined; // clear reference — we own it now
		let signatureHex: { r: string; s: string; v: number } | undefined;
		try {
			// Resolve chain from stored transaction chainId
			const chain = await this.chainRegistry.getChain(state.transaction.chainId);

			// SECURITY: Server computes the messageHash from the stored transaction
			// rather than trusting the client-provided hash. This prevents hash
			// substitution attacks where the client signs a different message.
			const txBytes = await chain.buildTransaction(state.transaction);
			const messageHash = new Uint8Array(
				hexToBytes(keccak256(toHex(txBytes))),
			);

			// DKLs23 signing finalization:
			// 1. Server calls lastMessage(messageHash) to get server's last broadcast
			const serverLastMsg = serverSession.lastMessage(messageHash);

			// 2. Deserialize signer's lastMessage
			const signerLastMsg = deserializeMessage(input.lastMessage);

			// 3. combine() with signer's lastMessage → [R, S]
			// combine() consumes the session and deallocates all internal data
			const result = serverSession.combine([signerLastMsg]) as [Uint8Array, Uint8Array];
			try { serverLastMsg.free(); } catch { /* consumed */ }
			try { signerLastMsg.free(); } catch { /* consumed */ }

			const r = new Uint8Array(result[0]);
			const s = new Uint8Array(result[1]);
			const v = this.computeRecoveryId(r, s, messageHash, state.expectedPublicKey);
			signatureHex = { r: toHex(r), s: toHex(s), v };

			// Broadcast the signed transaction
			const signedTxBytes = chain.serializeSignedTransaction(txBytes, { r, s, v });
			const txHash = await chain.broadcastTransaction(signedTxBytes);

			// Log success to audit
			await this.signingRequestRepo.create({
				signerId: state.signerId,
				ownerAddress: state.ownerAddress,
				requestType: RequestType.SIGN_TX,
				signingPath: state.signingPath,
				status: RequestStatus.APPROVED,
				toAddress: state.decodedTo,
				valueWei: state.transaction.value?.toString(),
				chainId: state.transaction.chainId,
				txHash,
				decodedAction: state.decodedFunctionName,
				policiesEvaluated: state.policyResult.evaluatedCount,
				evaluationTimeMs: state.policyResult.evaluationTimeMs,
			});

			return {
				txHash,
				signature: signatureHex,
			};
		} catch (error) {
			// Log failure — include signature details if signing succeeded but broadcast failed
			if (signatureHex) {
				this.logger.error(
					`Broadcast failed but signature was produced: r=${signatureHex.r} s=${signatureHex.s} v=${signatureHex.v}`,
				);
			}
			await this.signingRequestRepo.create({
				signerId: state.signerId,
				ownerAddress: state.ownerAddress,
				requestType: RequestType.SIGN_TX,
				signingPath: state.signingPath,
				status: RequestStatus.FAILED,
				toAddress: state.decodedTo,
				valueWei: state.transaction.value?.toString(),
				chainId: state.transaction.chainId,
				decodedAction: state.decodedFunctionName,
				txData: signatureHex ? JSON.stringify(signatureHex) : undefined,
				policiesEvaluated: state.policyResult.evaluatedCount,
				evaluationTimeMs: state.policyResult.evaluationTimeMs,
			});
			throw error;
		} finally {
			try { serverSession.free(); } catch { /* already consumed by combine() */ }
			// CRITICAL: Wipe session state including server keyshare bytes
			this.destroySession(input.sessionId);
		}
	}

	async createMessageSession(input: CreateMessageSessionInput): Promise<CreateSessionOutput> {
		if (this.sessions.size >= MAX_CONCURRENT_SESSIONS) {
			throw new ForbiddenException('Too many concurrent signing sessions. Try again later.');
		}
		const signingPath = input.signingPath ?? SigningPath.SIGNER_SERVER;

		// Step 1: Verify signer
		const signer = await this.signerRepo.findById(input.signerId);
		if (!signer) {
			throw new NotFoundException('Signer not found');
		}
		if (signer.status !== 'active') {
			throw new ForbiddenException(`Signer is ${signer.status}`);
		}

		// Step 2: Build policy context (message signing has zero value, no tx)
		const now = new Date();
		const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
		const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

		const [requestsLastHour, requestsToday] = await Promise.all([
			this.signingRequestRepo.countBySignerInWindow(signer.id, hourAgo),
			this.signingRequestRepo.countBySignerInWindow(signer.id, dayAgo),
		]);

		const policyContext: PolicyContext = {
			signerAddress: signer.ethAddress,
			valueWei: 0n,
			chainId: 0,
			rollingDailySpendWei: 0n,
			rollingMonthlySpendWei: 0n,
			requestCountLastHour: requestsLastHour,
			requestCountToday: requestsToday,
			currentHourUtc: now.getUTCHours(),
			timestamp: now,
			callerIp: input.callerIp,
		};

		// Step 3: Evaluate policies — try rules engine first, fall back to legacy
		const policyDoc = await this.policyDocRepo.findBySigner(signer.id);
		let policyResult;

		if (policyDoc) {
			policyResult = await this.rulesEngine.evaluate(policyDoc, policyContext);
		} else {
			const enabledPolicies = await this.policyRepo.findEnabledBySigner(signer.id);
			policyResult = await this.policyEngine.evaluate(
				enabledPolicies.map((p) => ({
					id: p.id,
					type: p.type,
					config: p.config as unknown as Record<string, unknown>,
					enabled: p.enabled,
				})),
				policyContext,
			);
		}

		if (!policyResult.allowed) {
			await this.signingRequestRepo.create({
				signerId: signer.id,
				ownerAddress: signer.ownerAddress,
				requestType: RequestType.SIGN_MESSAGE,
				signingPath,
				status: RequestStatus.BLOCKED,
				policyViolations: policyResult.violations as unknown as Record<string, unknown>[],
				policiesEvaluated: policyResult.evaluatedCount,
				evaluationTimeMs: policyResult.evaluationTimeMs,
			}).catch((err) => this.logger.error(`Failed to write blocked audit log: ${err}`));

			throw new ForbiddenException({
				message: 'Message signing blocked by policy',
				violations: policyResult.violations.map(({ type, reason }) => ({ type, reason })),
			});
		}

		// Step 4: Fetch server keyshare and create SignSession
		let serverKeyshareBytes: Uint8Array | null = null;
		let serverSession: SignSession | null = null;
		try {
			serverKeyshareBytes = await this.vault.getShare(signer.vaultSharePath);

			const serverKeyshare = Keyshare.fromBytes(serverKeyshareBytes);
			const expectedPublicKey = new Uint8Array(serverKeyshare.publicKey);
			serverSession = new SignSession(serverKeyshare, 'm');

			const serverFirstMsg = serverSession.createFirstMessage();
			const serverFirstMsgBytes = serializeMessage(serverFirstMsg);
			serverFirstMsg.free();

			// Process signer's first message (broadcast) immediately
			const signerFirstMsg = deserializeMessage(input.signerFirstMessage);
			const serverRound1Msgs = serverSession.handleMessages([signerFirstMsg]);
			try { signerFirstMsg.free(); } catch { /* already consumed */ }

			const round1Bytes: Uint8Array[] = [];
			for (const msg of serverRound1Msgs) {
				round1Bytes.push(serializeMessage(msg));
				try { msg.free(); } catch { /* already consumed */ }
			}

			const serverSessionBytes = serverSession.toBytes();
			try { serverSession.free(); } catch { /* may be consumed */ }
			serverSession = null;

			const sessionId = randomUUID();
			this.sessions.set(sessionId, {
				type: 'message',
				signerId: signer.id,
				ethAddress: signer.ethAddress,
				ownerAddress: signer.ownerAddress,
				expectedPublicKey,
				signingPath,
				serverKeyshareBytes,
				policyResult: {
					evaluatedCount: policyResult.evaluatedCount,
					evaluationTimeMs: policyResult.evaluationTimeMs,
				},
				round: 1,
				createdAt: Date.now(),
				serverSessionBytes,
			});

			return {
				sessionId,
				serverFirstMessage: serverFirstMsgBytes,
				initialRoundMessages: round1Bytes,
				roundsRemaining: 3,
			};
		} catch (error) {
			if (serverSession) {
				try { serverSession.free(); } catch { /* may be consumed */ }
			}
			if (serverKeyshareBytes) {
				wipeBuffer(serverKeyshareBytes);
			}
			if (!(error instanceof ForbiddenException) && !(error instanceof NotFoundException)) {
				await this.signingRequestRepo.create({
					signerId: signer.id,
					ownerAddress: signer.ownerAddress,
					requestType: RequestType.SIGN_MESSAGE,
					signingPath,
					status: RequestStatus.FAILED,
					policiesEvaluated: policyResult.evaluatedCount,
					evaluationTimeMs: policyResult.evaluationTimeMs,
				});
			}
			throw error;
		}
	}

	async completeMessageSign(input: CompleteSignInput): Promise<CompleteMessageSignOutput> {
		const state = this.getValidSession(input.sessionId);
		if (state.signerId !== input.signerId) {
			throw new ForbiddenException('Session does not belong to this signer');
		}

		// Re-check signer status — reject if paused/revoked since session creation
		const signer = await this.signerRepo.findById(state.signerId);
		if (!signer || signer.status !== 'active') {
			this.destroySession(input.sessionId);
			throw new ForbiddenException(`Signer is ${signer?.status ?? 'deleted'}`);
		}

		const serverSession = state.liveSession ?? SignSession.fromBytes(state.serverSessionBytes);
		state.liveSession = undefined;
		try {
			const serverLastMsg = serverSession.lastMessage(input.messageHash);
			const signerLastMsg = deserializeMessage(input.lastMessage);

			const result = serverSession.combine([signerLastMsg]) as [Uint8Array, Uint8Array];
			try { serverLastMsg.free(); } catch { /* consumed */ }
			try { signerLastMsg.free(); } catch { /* consumed */ }

			const r = new Uint8Array(result[0]);
			const s = new Uint8Array(result[1]);
			const v = this.computeRecoveryId(r, s, input.messageHash, state.expectedPublicKey);

			// Log success to audit
			await this.signingRequestRepo.create({
				signerId: state.signerId,
				ownerAddress: state.ownerAddress,
				requestType: RequestType.SIGN_MESSAGE,
				signingPath: state.signingPath,
				status: RequestStatus.APPROVED,
				policiesEvaluated: state.policyResult.evaluatedCount,
				evaluationTimeMs: state.policyResult.evaluationTimeMs,
			});

			return {
				signature: {
					r: toHex(r),
					s: toHex(s),
					v,
				},
			};
		} catch (error) {
			await this.signingRequestRepo.create({
				signerId: state.signerId,
				ownerAddress: state.ownerAddress,
				requestType: RequestType.SIGN_MESSAGE,
				signingPath: state.signingPath,
				status: RequestStatus.FAILED,
				policiesEvaluated: state.policyResult.evaluatedCount,
				evaluationTimeMs: state.policyResult.evaluationTimeMs,
			});
			throw error;
		} finally {
			try { serverSession.free(); } catch { /* may be consumed by handleMessages/combine */ }
			this.destroySession(input.sessionId);
		}
	}

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
		const expectedHex = Buffer.from(expectedPublicKey).toString('hex');

		for (const recoveryBit of [0, 1] as const) {
			try {
				const sig = new secp256k1.Signature(rBig, sBig).addRecoveryBit(recoveryBit);
				const recovered = sig.recoverPublicKey(messageHash);
				const recoveredHex = Buffer.from(recovered.toBytes(true)).toString('hex');
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

	private getValidSession(sessionId: string): SignSessionState {
		const state = this.sessions.get(sessionId);
		if (!state) {
			throw new NotFoundException('Signing session not found or expired');
		}
		if (Date.now() - state.createdAt > SESSION_TTL_MS) {
			this.destroySession(sessionId);
			throw new ForbiddenException('Signing session expired');
		}
		return state;
	}

	private destroySession(sessionId: string): void {
		const state = this.sessions.get(sessionId);
		if (state) {
			wipeBuffer(state.serverKeyshareBytes);
			wipeBuffer(state.serverSessionBytes);
			if (state.liveSession) {
				try { state.liveSession.free(); } catch { /* may be consumed */ }
				state.liveSession = undefined;
			}
			this.sessions.delete(sessionId);
			this.logger.debug(`Session ${sessionId} destroyed, keyshare wiped`);
		}
	}

	/** 20% buffer on top of estimated gas to handle variance. */
	private static readonly GAS_LIMIT_BUFFER = 120n;

	/**
	 * Auto-populate missing transaction fields (chainId, nonce, gas)
	 * from on-chain state so clients don't need to provide them.
	 *
	 * Fee estimation delegates to the RPC node via `estimateFeesPerGas()`
	 * which returns EIP-1559 fee suggestions based on recent blocks.
	 * No hardcoded gas prices — works on L1, L2s, and testnets.
	 */
	private async populateTransaction(
		tx: TransactionRequest,
		signerAddress: string,
		chain: IChain,
	): Promise<TransactionRequest> {
		const chainId = tx.chainId || chain.chainId;
		const nonce = tx.nonce ?? await chain.getNonce(signerAddress);

		let gasLimit = tx.gasLimit;
		if (!gasLimit) {
			const estimated = await chain.estimateGas({
				from: signerAddress,
				to: tx.to,
				value: tx.value,
				data: tx.data,
			});
			gasLimit = (estimated * InteractiveSignService.GAS_LIMIT_BUFFER) / 100n;
		}

		let { maxFeePerGas, maxPriorityFeePerGas, gasPrice } = tx;
		if (!maxFeePerGas && !gasPrice) {
			const fees = await chain.estimateFeesPerGas();
			maxFeePerGas = fees.maxFeePerGas;
			maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
		}

		return { ...tx, chainId, nonce, gasLimit, maxFeePerGas, maxPriorityFeePerGas, gasPrice };
	}

	private cleanupExpiredSessions(): void {
		const now = Date.now();
		for (const [id, state] of this.sessions) {
			if (now - state.createdAt > SESSION_TTL_MS) {
				this.destroySession(id);
				this.logger.debug(`Expired session ${id} cleaned up`);
			}
		}
	}
}
