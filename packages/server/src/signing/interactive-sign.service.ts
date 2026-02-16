import { randomBytes, randomUUID } from 'node:crypto';
import {
	ForbiddenException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
	OnModuleDestroy,
} from '@nestjs/common';
import type {
	IChain,
	IPolicyEngine,
	IRulesEngine,
	IThresholdScheme,
	IVaultStore,
	KeyMaterial,
	PolicyContext,
	TransactionRequest,
} from '@agentokratia/guardian-core';
import { RequestStatus, RequestType, SigningPath } from '@agentokratia/guardian-core';
import { CGGMP24Scheme } from '@agentokratia/guardian-schemes';
import { hexToBytes, keccak256, toHex } from 'viem';
import { SigningRequestRepository } from '../audit/signing-request.repository.js';
import { ChainRegistryService } from '../common/chain.module.js';
import { wipeBuffer } from '../common/crypto-utils.js';
import { VAULT_STORE } from '../common/vault.module.js';
import { PolicyDocumentRepository } from '../policies/policy-document.repository.js';
import { PolicyRepository } from '../policies/policy.repository.js';
import { SignerRepository } from '../signers/signer.repository.js';

const SESSION_TTL_MS = 120_000;
const CLEANUP_INTERVAL_MS = 10_000;
const MAX_CONCURRENT_SESSIONS = 1_000;

interface BaseSessionState {
	readonly signerId: string;
	readonly ethAddress: string;
	readonly ownerAddress: string;
	readonly expectedPublicKey: Uint8Array;
	readonly signingPath: SigningPath;
	readonly serverKeyMaterialBytes: Uint8Array;
	readonly policyResult: { evaluatedCount: number; evaluationTimeMs: number };
	/** The scheme's internal sign session ID */
	readonly schemeSessionId: string;
	round: number;
	readonly createdAt: number;
}

interface TxSessionState extends BaseSessionState {
	readonly type: 'tx';
	readonly transaction: TransactionRequest;
	readonly decodedTo: string;
	readonly decodedFunctionName: string | undefined;
	readonly messageHash: Uint8Array;
}

interface MessageSessionState extends BaseSessionState {
	readonly type: 'message';
}

type SignSessionState = TxSessionState | MessageSessionState;

export interface CreateSessionInput {
	readonly signerId: string;
	readonly signerFirstMessage?: Uint8Array;
	readonly transaction: TransactionRequest;
	readonly signingPath?: SigningPath;
	readonly callerIp?: string;
}

export interface CreateSessionOutput {
	readonly sessionId: string;
	readonly serverFirstMessages: Uint8Array[];
	readonly messageHash: Uint8Array;
	readonly eid: Uint8Array;
	readonly partyConfig: { serverPartyIndex: number; clientPartyIndex: number; partiesAtKeygen: number[] };
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
	readonly complete: boolean;
}

export interface CompleteSignInput {
	readonly sessionId: string;
	readonly signerId: string;
}

export interface CompleteSignOutput {
	readonly txHash: string;
	readonly signature: { r: string; s: string; v: number };
}

export interface CreateMessageSessionInput {
	readonly signerId: string;
	readonly signerFirstMessage?: Uint8Array;
	readonly messageHash: Uint8Array;
	readonly signingPath?: SigningPath;
	readonly callerIp?: string;
}

export interface CompleteMessageSignOutput {
	readonly signature: { r: string; s: string; v: number };
}

/**
 * CGGMP24 interactive signing service.
 *
 * - Message hash computed BEFORE signing starts
 * - Signature extracted when protocol completes (no separate finalize step)
 * - State machine API: safe to serialize between rounds
 * - Key material is { coreShare, auxInfo }
 */
@Injectable()
export class InteractiveSignService implements OnModuleDestroy {
	private readonly logger = new Logger(InteractiveSignService.name);
	private readonly sessions = new Map<string, SignSessionState>();
	private readonly scheme: IThresholdScheme;
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
		this.scheme = new CGGMP24Scheme();
		this.cleanupTimer = setInterval(() => this.cleanupExpiredSessions(), CLEANUP_INTERVAL_MS);
	}

	onModuleDestroy(): void {
		clearInterval(this.cleanupTimer);
		for (const [id, state] of this.sessions) {
			wipeBuffer(state.serverKeyMaterialBytes);
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

		// Step 2: Resolve chain and populate transaction
		if (!input.transaction.chainId || input.transaction.chainId === 0) {
			throw new ForbiddenException('chainId is required in transaction');
		}
		const chain = await this.chainRegistry.getChain(input.transaction.chainId);
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

		// Step 4: Evaluate policies
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

		// Step 6: Compute messageHash BEFORE signing starts (CGGMP24 requirement)
		const messageHash = new Uint8Array(hexToBytes(keccak256(toHex(txBytes))));

		// Step 6b: Generate execution ID and determine party config
		const eid = Uint8Array.from(randomBytes(32));
		const { serverPartyIndex, clientPartyIndex, partiesAtKeygen } =
			this.getPartyConfig(signingPath);

		// Step 7: Fetch server key material from Vault
		let serverKeyMaterialBytes: Uint8Array | null = null;
		try {
			serverKeyMaterialBytes = await this.vault.getShare(signer.vaultSharePath);

			// Parse key material: { coreShare, auxInfo }
			const keyMaterial = parseKeyMaterial(serverKeyMaterialBytes);

			// Extract public key for recovery ID computation
			let expectedPublicKey: Uint8Array = new Uint8Array(33);
			if (this.scheme.extractPublicKey) {
				try {
					expectedPublicKey = this.scheme.extractPublicKey(
						new Uint8Array(keyMaterial.coreShare),
					);
				} catch {
					// Non-fatal — recovery ID computation will fail gracefully
				}
			}

			// Step 8: Create server sign session with hash + party config
			// User+Server path: force WASM backend so both sides (browser + server)
			// use the same num-bigint backend. Native GMP (rug) protocol messages
			// are incompatible with browser WASM (num-bigint).
			const forceWasm = signingPath === SigningPath.USER_SERVER;
			const { sessionId: schemeSessionId, firstMessages } =
				await this.scheme.createSignSession(
					[keyMaterial.coreShare, keyMaterial.auxInfo],
					messageHash,
					{ partyIndex: serverPartyIndex, partiesAtKeygen, eid, forceWasm },
				);

			// Wipe parsed key material (the raw bytes are kept for session state)
			wipeBuffer(keyMaterial.coreShare);
			wipeBuffer(keyMaterial.auxInfo);

			// Step 9: Store session state (no immediate processSignRound —
			// the client hasn't created its session yet for tx signing)
			const sessionId = randomUUID();
			this.sessions.set(sessionId, {
				type: 'tx',
				signerId: signer.id,
				ethAddress: signer.ethAddress,
				ownerAddress: signer.ownerAddress,
				expectedPublicKey,
				signingPath,
				serverKeyMaterialBytes,
				transaction: populatedTx,
				decodedTo: decoded.to,
				decodedFunctionName: decoded.functionName,
				messageHash,
				policyResult: {
					evaluatedCount: policyResult.evaluatedCount,
					evaluationTimeMs: policyResult.evaluationTimeMs,
				},
				schemeSessionId,
				round: 0,
				createdAt: Date.now(),
			});

			return {
				sessionId,
				serverFirstMessages: firstMessages,
				messageHash,
				eid,
				partyConfig: { serverPartyIndex, clientPartyIndex, partiesAtKeygen },
				roundsRemaining: 4,
			};
		} catch (error) {
			if (serverKeyMaterialBytes) {
				wipeBuffer(serverKeyMaterialBytes);
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

		const signer = await this.signerRepo.findById(state.signerId);
		if (!signer || signer.status !== 'active') {
			this.destroySession(input.sessionId);
			throw new ForbiddenException(`Signer is ${signer?.status ?? 'deleted'}`);
		}

		// Drive the scheme's state machine with incoming messages
		let result: { outgoingMessages: Uint8Array[]; complete: boolean };
		try {
			result = await this.scheme.processSignRound(
				state.schemeSessionId,
				input.incomingMessages,
			);
			this.logger.debug(`processRound: session=${input.sessionId.slice(0, 8)} round=${state.round + 1} msgs=${input.incomingMessages.length} → outgoing=${result.outgoingMessages.length} complete=${result.complete}`);
		} catch (err) {
			this.logger.error(`processSignRound WASM error (round ${state.round + 1}): ${String(err)}`);
			this.destroySession(input.sessionId);
			throw err;
		}

		state.round += 1;
		const roundsRemaining = result.complete ? 0 : Math.max(1, 4 - state.round);

		return {
			outgoingMessages: result.outgoingMessages,
			roundsRemaining,
			complete: result.complete,
		};
	}

	async completeSign(input: CompleteSignInput): Promise<CompleteSignOutput> {
		const state = this.getValidSession(input.sessionId);
		if (state.signerId !== input.signerId) {
			throw new ForbiddenException('Session does not belong to this signer');
		}
		if (state.type !== 'tx') {
			throw new ForbiddenException('Session is not a transaction session. Use /sign-message/complete instead.');
		}

		const signer = await this.signerRepo.findById(state.signerId);
		if (!signer || signer.status !== 'active') {
			this.destroySession(input.sessionId);
			throw new ForbiddenException(`Signer is ${signer?.status ?? 'deleted'}`);
		}

		let signatureHex: { r: string; s: string; v: number } | undefined;
		try {
			// Extract signature from completed session (no lastMessage step)
			const { r, s, v } = await this.scheme.finalizeSign(state.schemeSessionId);
			signatureHex = { r: toHex(r), s: toHex(s), v };

			// Broadcast the signed transaction
			const chain = await this.chainRegistry.getChain(state.transaction.chainId);
			const txBytes = await chain.buildTransaction(state.transaction);
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

			return { txHash, signature: signatureHex };
		} catch (error) {
			if (signatureHex) {
				this.logger.error(
					`Broadcast failed but signature was produced (r=${signatureHex.r.slice(0, 10)}... v=${signatureHex.v})`,
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
			this.destroySession(input.sessionId);
		}
	}

	async createMessageSession(input: CreateMessageSessionInput): Promise<CreateSessionOutput> {
		if (this.sessions.size >= MAX_CONCURRENT_SESSIONS) {
			throw new ForbiddenException('Too many concurrent signing sessions. Try again later.');
		}
		const signingPath = input.signingPath ?? SigningPath.SIGNER_SERVER;

		const signer = await this.signerRepo.findById(input.signerId);
		if (!signer) {
			throw new NotFoundException('Signer not found');
		}
		if (signer.status !== 'active') {
			throw new ForbiddenException(`Signer is ${signer.status}`);
		}

		// Policy evaluation for message signing
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

		// Generate EID and determine party config
		const eid = Uint8Array.from(randomBytes(32));
		const { serverPartyIndex, clientPartyIndex, partiesAtKeygen } =
			this.getPartyConfig(signingPath);

		// Fetch server key material and create sign session with hash upfront
		let serverKeyMaterialBytes: Uint8Array | null = null;
		try {
			serverKeyMaterialBytes = await this.vault.getShare(signer.vaultSharePath);
			const keyMaterial = parseKeyMaterial(serverKeyMaterialBytes);

			// Extract public key for recovery ID computation
			let expectedPublicKey: Uint8Array = new Uint8Array(33);
			if (this.scheme.extractPublicKey) {
				try {
					expectedPublicKey = this.scheme.extractPublicKey(
						new Uint8Array(keyMaterial.coreShare),
					);
				} catch {
					// Non-fatal
				}
			}

			// CGGMP24: messageHash required upfront
			// Force WASM for User+Server path (browser uses WASM num-bigint backend)
			const forceWasm = signingPath === SigningPath.USER_SERVER;
			const { sessionId: schemeSessionId, firstMessages } =
				await this.scheme.createSignSession(
					[keyMaterial.coreShare, keyMaterial.auxInfo],
					input.messageHash,
					{ partyIndex: serverPartyIndex, partiesAtKeygen, eid, forceWasm },
				);

			wipeBuffer(keyMaterial.coreShare);
			wipeBuffer(keyMaterial.auxInfo);

			// For message signing, client may send signerFirstMessage upfront
			// Process it immediately to get server's round 1 response
			let allServerMessages = [...firstMessages];
			let round = 0;
			if (input.signerFirstMessage) {
				const signerResult = await this.scheme.processSignRound(
					schemeSessionId,
					[input.signerFirstMessage],
				);
				allServerMessages = [...allServerMessages, ...signerResult.outgoingMessages];
				round = 1;
			}

			const sessionId = randomUUID();
			this.sessions.set(sessionId, {
				type: 'message',
				signerId: signer.id,
				ethAddress: signer.ethAddress,
				ownerAddress: signer.ownerAddress,
				expectedPublicKey,
				signingPath,
				serverKeyMaterialBytes,
				policyResult: {
					evaluatedCount: policyResult.evaluatedCount,
					evaluationTimeMs: policyResult.evaluationTimeMs,
				},
				schemeSessionId,
				round,
				createdAt: Date.now(),
			});

			return {
				sessionId,
				serverFirstMessages: allServerMessages,
				messageHash: input.messageHash,
				eid,
				partyConfig: { serverPartyIndex, clientPartyIndex, partiesAtKeygen },
				roundsRemaining: 4,
			};
		} catch (error) {
			if (serverKeyMaterialBytes) {
				wipeBuffer(serverKeyMaterialBytes);
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

		const signer = await this.signerRepo.findById(state.signerId);
		if (!signer || signer.status !== 'active') {
			this.destroySession(input.sessionId);
			throw new ForbiddenException(`Signer is ${signer?.status ?? 'deleted'}`);
		}

		try {
			// Extract signature — no lastMessage step in CGGMP24
			const { r, s, v } = await this.scheme.finalizeSign(state.schemeSessionId);

			await this.signingRequestRepo.create({
				signerId: state.signerId,
				ownerAddress: state.ownerAddress,
				requestType: RequestType.SIGN_MESSAGE,
				signingPath: state.signingPath,
				status: RequestStatus.APPROVED,
				policiesEvaluated: state.policyResult.evaluatedCount,
				evaluationTimeMs: state.policyResult.evaluationTimeMs,
			});

			return { signature: { r: toHex(r), s: toHex(s), v } };
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
			this.destroySession(input.sessionId);
		}
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
			wipeBuffer(state.serverKeyMaterialBytes);
			this.sessions.delete(sessionId);
			this.logger.debug(`Session ${sessionId} destroyed, key material wiped`);
		}
	}

	private static readonly GAS_LIMIT_BUFFER = 120n;

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

	/**
	 * Determine party indices based on the signing path.
	 *
	 * DKG party assignments:
	 *   0 = signer (CLI/SDK agent)
	 *   1 = server
	 *   2 = user (browser/wallet)
	 */
	private getPartyConfig(signingPath: SigningPath): {
		serverPartyIndex: number;
		clientPartyIndex: number;
		partiesAtKeygen: number[];
	} {
		switch (signingPath) {
			case SigningPath.SIGNER_SERVER:
				return { serverPartyIndex: 1, clientPartyIndex: 0, partiesAtKeygen: [0, 1] };
			case SigningPath.USER_SERVER:
				return { serverPartyIndex: 1, clientPartyIndex: 2, partiesAtKeygen: [1, 2] };
			default:
				return { serverPartyIndex: 1, clientPartyIndex: 0, partiesAtKeygen: [0, 1] };
		}
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

/**
 * Parse key material from Vault: JSON { coreShare: base64, auxInfo: base64 }
 */
function parseKeyMaterial(bytes: Uint8Array): { coreShare: Uint8Array; auxInfo: Uint8Array } {
	const json = new TextDecoder().decode(bytes);
	const parsed = JSON.parse(json) as { coreShare: string; auxInfo: string };
	return {
		coreShare: new Uint8Array(Buffer.from(parsed.coreShare, 'base64')),
		auxInfo: new Uint8Array(Buffer.from(parsed.auxInfo, 'base64')),
	};
}
