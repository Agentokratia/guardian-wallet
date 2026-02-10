import {
	ChainName,
	NetworkName,
	RequestStatus,
	RequestType,
	SchemeName,
	SignerStatus,
	SignerType,
	SigningPath,
} from '@agentokratia/guardian-core';
import type { IChain, IPolicyEngine, IRulesEngine, IVaultStore, Signer } from '@agentokratia/guardian-core';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hexToBytes, keccak256, toHex } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SigningRequestRepository } from '../../audit/signing-request.repository.js';
import type { ChainRegistryService } from '../../common/chain.module.js';
import * as cryptoUtils from '../../common/crypto-utils.js';
import type { PolicyDocumentRepository } from '../../policies/policy-document.repository.js';
import type { PolicyRepository } from '../../policies/policy.repository.js';
import type { SignerRepository } from '../../signers/signer.repository.js';
import { InteractiveSignService } from '../interactive-sign.service.js';

// ---------------------------------------------------------------------------
// Generate a REAL secp256k1 keypair + signature for consistent mock data.
// The WASM protocol is mocked but the crypto math is real.
// ---------------------------------------------------------------------------

const TEST_PRIVATE_KEY = new Uint8Array(32);
TEST_PRIVATE_KEY[31] = 1; // minimal valid private key
const TEST_PUBLIC_KEY = secp256k1.getPublicKey(TEST_PRIVATE_KEY, true); // compressed 33 bytes

// The mock chain.buildTransaction returns new Uint8Array([1, 2, 3]).
// The service computes messageHash = keccak256(toHex(txBytes)) from that.
// We must use the SAME hash here so recovery ID computation succeeds.
const MOCK_TX_BYTES = new Uint8Array([1, 2, 3]);
const TEST_MESSAGE_HASH = new Uint8Array(hexToBytes(keccak256(toHex(MOCK_TX_BYTES))));

// Sign the pre-hashed keccak256 directly (prehash: false skips internal SHA-256).
// This matches DKLs23 which signs the keccak256 hash without re-hashing.
const testSigBytes = secp256k1.sign(TEST_MESSAGE_HASH, TEST_PRIVATE_KEY, { prehash: false });
const TEST_R = new Uint8Array(testSigBytes.slice(0, 32));
const TEST_S = new Uint8Array(testSigBytes.slice(32, 64));

// ---------------------------------------------------------------------------
// Mock the WASM library — protocol is mocked, crypto values are real
// ---------------------------------------------------------------------------

vi.mock('@silencelaboratories/dkls-wasm-ll-node', () => {
	const mockMessage = {
		payload: new Uint8Array([1, 2, 3]),
		from_id: 1,
		to_id: undefined,
		free: vi.fn(),
	};

	const mockSessionInstance = () => ({
		createFirstMessage: vi.fn(() => mockMessage),
		toBytes: vi.fn(() => new Uint8Array([10, 20, 30])),
		handleMessages: vi.fn(() => [mockMessage]),
		lastMessage: vi.fn(() => mockMessage),
		// Return REAL r, s values so computeRecoveryId works with real secp256k1
		combine: vi.fn(() => [TEST_R, TEST_S]),
		free: vi.fn(),
	});

	const SignSessionConstructor = Object.assign(
		vi.fn().mockImplementation(mockSessionInstance),
		{ fromBytes: vi.fn().mockImplementation(mockSessionInstance) },
	);

	return {
		Keyshare: {
			// Return REAL compressed public key so recovery ID matches
			fromBytes: vi.fn(() => ({ __keyshare: true, publicKey: TEST_PUBLIC_KEY })),
		},
		SignSession: SignSessionConstructor,
		Message: vi.fn().mockImplementation((payload: Uint8Array, from: number, to?: number) => ({
			payload,
			from_id: from,
			to_id: to,
			free: vi.fn(),
		})),
	};
});

// Spy on wipeBuffer so we can verify it's called
vi.mock('../../common/crypto-utils.js', async () => {
	const actual = await vi.importActual<typeof cryptoUtils>('../../common/crypto-utils.js');
	return {
		...actual,
		wipeBuffer: vi.fn(actual.wipeBuffer),
	};
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a properly formatted DKLs23 wire-format message.
 * Format: [from:u8][hasTo:u8][to:u8][payloadLen:u32BE][payload]
 */
function makeWireMessage(from = 0, to?: number, payload = new Uint8Array([1, 2, 3])): Uint8Array {
	const buf = new Uint8Array(7 + payload.length);
	buf[0] = from;
	buf[1] = to !== undefined ? 1 : 0;
	buf[2] = to ?? 0;
	const view = new DataView(buf.buffer);
	view.setUint32(3, payload.length, false);
	buf.set(payload, 7);
	return buf;
}

function makeSigner(overrides: Partial<Signer> = {}): Signer {
	return {
		id: 'signer-1',
		name: 'Test Agent',
		type: SignerType.AI_AGENT,
		ethAddress: '0xabc123',
		chain: ChainName.ETHEREUM,
		scheme: SchemeName.CGGMP21,
		network: NetworkName.SEPOLIA,
		status: SignerStatus.ACTIVE,
		ownerAddress: '0xTestOwner',
		apiKeyHash: 'hash123',
		vaultSharePath: 'threshold/shares/signer-1',
		dkgCompleted: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

function makeTransaction() {
	return {
		to: '0xdef456' as `0x${string}`,
		value: 1000000000000000n,
		chainId: 11155111,
	};
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMocks() {
	const signerRepo = {
		findById: vi.fn(),
	};

	const signingRequestRepo = {
		create: vi.fn().mockResolvedValue(undefined),
		countBySignerInWindow: vi.fn().mockResolvedValue(0),
		sumValueBySignerInWindow: vi.fn().mockResolvedValue(0n),
	};

	const policyRepo = {
		findEnabledBySigner: vi.fn().mockResolvedValue([]),
		incrementTimesTriggered: vi.fn().mockResolvedValue(undefined),
	};

	const policyEngine = {
		evaluate: vi.fn().mockResolvedValue({
			allowed: true,
			violations: [],
			evaluatedCount: 0,
			evaluationTimeMs: 1,
		}),
	};

	const chain = {
		chainId: 11155111,
		name: 'sepolia',
		getNonce: vi.fn().mockResolvedValue(0),
		estimateGas: vi.fn().mockResolvedValue(21000n),
		getGasPrice: vi.fn().mockResolvedValue(1_000_000_000n),
		estimateFeesPerGas: vi.fn().mockResolvedValue({
			maxFeePerGas: 2_000_000_000n,
			maxPriorityFeePerGas: 100_000_000n,
		}),
		buildTransaction: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
		decodeTransaction: vi.fn().mockReturnValue({
			to: '0xdef456',
			functionSelector: undefined,
			functionName: undefined,
		}),
		serializeSignedTransaction: vi.fn().mockReturnValue(new Uint8Array([4, 5, 6])),
		broadcastTransaction: vi.fn().mockResolvedValue('0xtxhash123'),
	};

	const vault = {
		getShare: vi.fn().mockResolvedValue(new Uint8Array(64)),
	};

	const chainRegistry = {
		getChain: vi.fn().mockResolvedValue(chain),
		getChainByName: vi.fn().mockResolvedValue(chain),
		invalidateCache: vi.fn(),
	};

	const rulesEngine = {
		evaluate: vi.fn().mockResolvedValue({
			allowed: true,
			violations: [],
			evaluatedCount: 0,
			evaluationTimeMs: 0,
		}),
	};

	const policyDocRepo = {
		findBySigner: vi.fn().mockResolvedValue(null),
		upsert: vi.fn(),
	};

	return { signerRepo, signingRequestRepo, policyRepo, policyEngine, rulesEngine, policyDocRepo, chain, chainRegistry, vault };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InteractiveSignService', () => {
	let service: InteractiveSignService;
	let mocks: ReturnType<typeof createMocks>;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });

		mocks = createMocks();

		service = new InteractiveSignService(
			mocks.signerRepo as unknown as SignerRepository,
			mocks.signingRequestRepo as unknown as SigningRequestRepository,
			mocks.policyRepo as unknown as PolicyRepository,
			mocks.policyEngine as unknown as IPolicyEngine,
			mocks.rulesEngine as unknown as IRulesEngine,
			mocks.policyDocRepo as unknown as PolicyDocumentRepository,
			mocks.chainRegistry as unknown as ChainRegistryService,
			mocks.vault as unknown as IVaultStore,
		);
	});

	afterEach(() => {
		service.onModuleDestroy();
		vi.useRealTimers();
	});

	// -----------------------------------------------------------------------
	// createSession
	// -----------------------------------------------------------------------

	describe('createSession', () => {
		it('throws NotFoundException for missing signer', async () => {
			mocks.signerRepo.findById.mockResolvedValue(null);

			await expect(
				service.createSession({
					signerId: 'nonexistent',
					signerFirstMessage: makeWireMessage(),
					transaction: makeTransaction(),
				}),
			).rejects.toThrow('Signer not found');
		});

		it('throws ForbiddenException for paused signer', async () => {
			mocks.signerRepo.findById.mockResolvedValue(
				makeSigner({ status: SignerStatus.PAUSED }),
			);

			await expect(
				service.createSession({
					signerId: 'signer-1',
					signerFirstMessage: makeWireMessage(),
					transaction: makeTransaction(),
				}),
			).rejects.toThrow('Signer is paused');
		});

		it('throws ForbiddenException for revoked signer', async () => {
			mocks.signerRepo.findById.mockResolvedValue(
				makeSigner({ status: SignerStatus.REVOKED }),
			);

			await expect(
				service.createSession({
					signerId: 'signer-1',
					signerFirstMessage: makeWireMessage(),
					transaction: makeTransaction(),
				}),
			).rejects.toThrow('Signer is revoked');
		});

		it('throws ForbiddenException when policy blocks transaction', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());
			mocks.policyEngine.evaluate.mockResolvedValue({
				allowed: false,
				violations: [{ policyId: 'p1', type: 'spending_limit', reason: 'Exceeded' }],
				evaluatedCount: 1,
				evaluationTimeMs: 2,
			});

			await expect(
				service.createSession({
					signerId: 'signer-1',
					signerFirstMessage: makeWireMessage(),
					transaction: makeTransaction(),
				}),
			).rejects.toThrow('Transaction blocked by policy');
		});

		it('logs blocked request to audit when policy blocks', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());
			mocks.policyEngine.evaluate.mockResolvedValue({
				allowed: false,
				violations: [{ policyId: 'p1', type: 'spending_limit', reason: 'Exceeded' }],
				evaluatedCount: 1,
				evaluationTimeMs: 2,
			});

			await expect(
				service.createSession({
					signerId: 'signer-1',
					signerFirstMessage: makeWireMessage(),
					transaction: makeTransaction(),
				}),
			).rejects.toThrow();

			expect(mocks.signingRequestRepo.create).toHaveBeenCalledWith(
				expect.objectContaining({
					signerId: 'signer-1',
					requestType: RequestType.SIGN_TX,
					status: RequestStatus.BLOCKED,
				}),
			);
		});

		it('logs blocked audit entry with violations when policy blocks', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());
			mocks.policyEngine.evaluate.mockResolvedValue({
				allowed: false,
				violations: [
					{ policyId: 'p1', type: 'spending_limit', reason: 'Over' },
					{ policyId: 'p2', type: 'rate_limit', reason: 'Too fast' },
				],
				evaluatedCount: 2,
				evaluationTimeMs: 3,
			});

			await expect(
				service.createSession({
					signerId: 'signer-1',
					signerFirstMessage: makeWireMessage(),
					transaction: makeTransaction(),
				}),
			).rejects.toThrow();

			// Audit log captures all violations
			expect(mocks.signingRequestRepo.create).toHaveBeenCalledWith(
				expect.objectContaining({
					status: RequestStatus.BLOCKED,
					policyViolations: expect.arrayContaining([
						expect.objectContaining({ policyId: 'p1' }),
						expect.objectContaining({ policyId: 'p2' }),
					]),
				}),
			);
		});

		it('wipes keyshare bytes on vault/session error', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());
			const fakeKeyshare = new Uint8Array([99, 88, 77]);
			mocks.vault.getShare.mockResolvedValue(fakeKeyshare);

			// Make SignSession constructor throw
			const { SignSession } = await import('@silencelaboratories/dkls-wasm-ll-node');
			(SignSession as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
				throw new Error('WASM init failed');
			});

			await expect(
				service.createSession({
					signerId: 'signer-1',
					signerFirstMessage: makeWireMessage(),
					transaction: makeTransaction(),
				}),
			).rejects.toThrow('WASM init failed');

			expect(cryptoUtils.wipeBuffer).toHaveBeenCalledWith(fakeKeyshare);
		});

		it('returns sessionId, serverFirstMessage and roundsRemaining on success', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const result = await service.createSession({
				signerId: 'signer-1',
				signerFirstMessage: makeWireMessage(),
				transaction: makeTransaction(),
			});

			expect(result.sessionId).toBeDefined();
			expect(result.serverFirstMessage).toBeInstanceOf(Uint8Array);
			expect(result.roundsRemaining).toBe(3);
		});

	});

	// -----------------------------------------------------------------------
	// processRound
	// -----------------------------------------------------------------------

	describe('processRound', () => {
		it('throws NotFoundException for unknown sessionId', async () => {
			await expect(
				service.processRound({
					sessionId: 'nonexistent-session',
					signerId: 'signer-1',
					incomingMessages: [],
				}),
			).rejects.toThrow('Signing session not found or expired');
		});

		it('throws ForbiddenException for expired session', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const { sessionId } = await service.createSession({
				signerId: 'signer-1',
				signerFirstMessage: makeWireMessage(),
				transaction: makeTransaction(),
			});

			// Advance time past 60s TTL
			vi.advanceTimersByTime(61_000);

			await expect(
				service.processRound({
					sessionId,
					signerId: 'signer-1',
					incomingMessages: [],
				}),
			).rejects.toThrow('Signing session expired');
		});

		it('processes round and returns outgoing messages', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const { sessionId } = await service.createSession({
				signerId: 'signer-1',
				signerFirstMessage: makeWireMessage(),
				transaction: makeTransaction(),
			});

			const result = await service.processRound({
				sessionId,
				signerId: 'signer-1',
				incomingMessages: [new Uint8Array([1, 0, 0, 0, 0, 0, 3, 1, 2, 3])],
			});

			expect(result.outgoingMessages).toBeDefined();
			expect(result.roundsRemaining).toBeLessThanOrEqual(3);
			expect(typeof result.presigned).toBe('boolean');
		});
	});

	// -----------------------------------------------------------------------
	// completeSign
	// -----------------------------------------------------------------------

	describe('completeSign', () => {
		it('logs success to audit repository', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const { sessionId } = await service.createSession({
				signerId: 'signer-1',
				signerFirstMessage: makeWireMessage(),
				transaction: makeTransaction(),
			});

			await service.completeSign({
				sessionId,
				signerId: 'signer-1',
				lastMessage: new Uint8Array([1, 0, 0, 0, 0, 0, 3, 1, 2, 3]),
				messageHash: TEST_MESSAGE_HASH,
			});

			expect(mocks.signingRequestRepo.create).toHaveBeenCalledWith(
				expect.objectContaining({
					signerId: 'signer-1',
					requestType: RequestType.SIGN_TX,
					status: RequestStatus.APPROVED,
					txHash: '0xtxhash123',
				}),
			);
		});

		it('wipes session state in finally block', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const { sessionId } = await service.createSession({
				signerId: 'signer-1',
				signerFirstMessage: makeWireMessage(),
				transaction: makeTransaction(),
			});

			await service.completeSign({
				sessionId,
				signerId: 'signer-1',
				lastMessage: new Uint8Array([1, 0, 0, 0, 0, 0, 3, 1, 2, 3]),
				messageHash: TEST_MESSAGE_HASH,
			});

			// Session should be destroyed — second attempt throws
			await expect(
				service.completeSign({
					sessionId,
					signerId: 'signer-1',
					lastMessage: new Uint8Array([1, 0, 0, 0, 0, 0, 3, 1, 2, 3]),
					messageHash: TEST_MESSAGE_HASH,
				}),
			).rejects.toThrow('Signing session not found or expired');
		});

		it('returns txHash and signature with correct recovery ID', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const { sessionId } = await service.createSession({
				signerId: 'signer-1',
				signerFirstMessage: makeWireMessage(),
				transaction: makeTransaction(),
			});

			const result = await service.completeSign({
				sessionId,
				signerId: 'signer-1',
				lastMessage: new Uint8Array([1, 0, 0, 0, 0, 0, 3, 1, 2, 3]),
				messageHash: TEST_MESSAGE_HASH,
			});

			expect(result.txHash).toBe('0xtxhash123');
			expect(result.signature.r).toMatch(/^0x/);
			expect(result.signature.s).toMatch(/^0x/);
			// v should be 27 or 28 — real recovery from real signature
			expect([27, 28]).toContain(result.signature.v);
		});
	});

	// -----------------------------------------------------------------------
	// onModuleDestroy
	// -----------------------------------------------------------------------

	describe('onModuleDestroy', () => {
		it('wipes all active sessions', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			// Create two sessions
			const s1 = await service.createSession({
				signerId: 'signer-1',
				signerFirstMessage: makeWireMessage(),
				transaction: makeTransaction(),
			});
			const s2 = await service.createSession({
				signerId: 'signer-1',
				signerFirstMessage: makeWireMessage(),
				transaction: makeTransaction(),
			});

			vi.mocked(cryptoUtils.wipeBuffer).mockClear();

			service.onModuleDestroy();

			// Each session has serverKeyshareBytes + serverSessionBytes = 2 wipeBuffer calls each
			expect(cryptoUtils.wipeBuffer).toHaveBeenCalledTimes(4);

			// Both sessions destroyed
			await expect(
				service.processRound({ sessionId: s1.sessionId, signerId: 'signer-1', incomingMessages: [] }),
			).rejects.toThrow('Signing session not found');
			await expect(
				service.processRound({ sessionId: s2.sessionId, signerId: 'signer-1', incomingMessages: [] }),
			).rejects.toThrow('Signing session not found');
		});
	});

	// -----------------------------------------------------------------------
	// createMessageSession
	// -----------------------------------------------------------------------

	describe('createMessageSession', () => {
		it('throws NotFoundException for missing signer', async () => {
			mocks.signerRepo.findById.mockResolvedValue(null);

			await expect(
				service.createMessageSession({
					signerId: 'nonexistent',
					signerFirstMessage: makeWireMessage(),
				}),
			).rejects.toThrow('Signer not found');
		});

		it('throws ForbiddenException for paused signer', async () => {
			mocks.signerRepo.findById.mockResolvedValue(
				makeSigner({ status: SignerStatus.PAUSED }),
			);

			await expect(
				service.createMessageSession({
					signerId: 'signer-1',
					signerFirstMessage: makeWireMessage(),
				}),
			).rejects.toThrow('Signer is paused');
		});

		it('returns session output on success', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const result = await service.createMessageSession({
				signerId: 'signer-1',
				signerFirstMessage: makeWireMessage(),
			});

			expect(result.sessionId).toBeDefined();
			expect(result.serverFirstMessage).toBeInstanceOf(Uint8Array);
			expect(result.roundsRemaining).toBe(3);
		});
	});
});
