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
import type { IChain, IPolicyEngine, IRulesEngine, IShareStore, Signer } from '@agentokratia/guardian-core';
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
// Generate a REAL secp256k1 keypair for consistent mock data.
// ---------------------------------------------------------------------------

const TEST_PRIVATE_KEY = new Uint8Array(32);
TEST_PRIVATE_KEY[31] = 1; // minimal valid private key
const TEST_PUBLIC_KEY = secp256k1.getPublicKey(TEST_PRIVATE_KEY, true);

const MOCK_TX_BYTES = new Uint8Array([1, 2, 3]);
const TEST_MESSAGE_HASH = new Uint8Array(hexToBytes(keccak256(toHex(MOCK_TX_BYTES))));

const testSigBytes = secp256k1.sign(TEST_MESSAGE_HASH, TEST_PRIVATE_KEY, { prehash: false });
const TEST_R = new Uint8Array(testSigBytes.slice(0, 32));
const TEST_S = new Uint8Array(testSigBytes.slice(32, 64));

// ---------------------------------------------------------------------------
// Mock the CGGMP24Scheme — since InteractiveSignService creates its own
// scheme internally, we mock the @agentokratia/guardian-schemes module.
// ---------------------------------------------------------------------------

vi.mock('@agentokratia/guardian-schemes', () => {
	return {
		CGGMP24Scheme: vi.fn().mockImplementation(() => ({
			createSignSession: vi.fn(async () => ({
				sessionId: 'scheme-session-1',
				firstMessages: [new Uint8Array([10, 20, 30])],
			})),
			processSignRound: vi.fn(async () => ({
				outgoingMessages: [new Uint8Array([40, 50, 60])],
				complete: false,
			})),
			finalizeSign: vi.fn(async () => ({
				r: TEST_R,
				s: TEST_S,
				v: 27,
			})),
			deriveAddress: vi.fn(() => '0xabc123'),
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

/** Create a valid CGGMP24 key material JSON blob (what Vault returns). */
function makeKeyMaterialBlob(): Uint8Array {
	const json = JSON.stringify({
		coreShare: Buffer.from(new Uint8Array(64)).toString('base64'),
		auxInfo: Buffer.from(new Uint8Array(32)).toString('base64'),
	});
	return new Uint8Array(Buffer.from(json, 'utf-8'));
}

function makeSigner(overrides: Partial<Signer> = {}): Signer {
	return {
		id: 'signer-1',
		name: 'Test Agent',
		type: SignerType.AI_AGENT,
		ethAddress: '0xabc123',
		chain: ChainName.ETHEREUM,
		scheme: SchemeName.CGGMP24,
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
		getShare: vi.fn().mockResolvedValue(makeKeyMaterialBlob()),
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
			mocks.vault as unknown as IShareStore,
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
					signerFirstMessage: new Uint8Array([1, 2, 3]),
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
					signerFirstMessage: new Uint8Array([1, 2, 3]),
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
					signerFirstMessage: new Uint8Array([1, 2, 3]),
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
					signerFirstMessage: new Uint8Array([1, 2, 3]),
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
					signerFirstMessage: new Uint8Array([1, 2, 3]),
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

		it('returns sessionId, serverFirstMessages, messageHash, eid and partyConfig on success', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const result = await service.createSession({
				signerId: 'signer-1',
				transaction: makeTransaction(),
			});

			expect(result.sessionId).toBeDefined();
			expect(result.serverFirstMessages).toBeInstanceOf(Array);
			expect(result.messageHash).toBeInstanceOf(Uint8Array);
			expect(result.messageHash).toHaveLength(32);
			expect(result.eid).toBeInstanceOf(Uint8Array);
			expect(result.eid).toHaveLength(32);
			expect(result.partyConfig).toBeDefined();
			expect(result.partyConfig.serverPartyIndex).toBe(1);
			expect(result.partyConfig.clientPartyIndex).toBe(0);
			expect(result.roundsRemaining).toBe(4);
		});

		it('wipes key material on vault/session error', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());
			// Return invalid key material that will cause parseKeyMaterial to fail
			mocks.vault.getShare.mockResolvedValue(new Uint8Array([0, 1, 2]));

			await expect(
				service.createSession({
					signerId: 'signer-1',
					signerFirstMessage: new Uint8Array([1, 2, 3]),
					transaction: makeTransaction(),
				}),
			).rejects.toThrow();

			expect(cryptoUtils.wipeBuffer).toHaveBeenCalled();
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
				signerFirstMessage: new Uint8Array([1, 2, 3]),
				transaction: makeTransaction(),
			});

			// Advance time past 120s TTL
			vi.advanceTimersByTime(121_000);

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
				signerFirstMessage: new Uint8Array([1, 2, 3]),
				transaction: makeTransaction(),
			});

			const result = await service.processRound({
				sessionId,
				signerId: 'signer-1',
				incomingMessages: [new Uint8Array([10, 20, 30])],
			});

			expect(result.outgoingMessages).toBeDefined();
			expect(result.roundsRemaining).toBeLessThanOrEqual(3);
			expect(typeof result.complete).toBe('boolean');
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
				signerFirstMessage: new Uint8Array([1, 2, 3]),
				transaction: makeTransaction(),
			});

			await service.completeSign({
				sessionId,
				signerId: 'signer-1',
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
				signerFirstMessage: new Uint8Array([1, 2, 3]),
				transaction: makeTransaction(),
			});

			await service.completeSign({
				sessionId,
				signerId: 'signer-1',
			});

			// Session should be destroyed — second attempt throws
			await expect(
				service.completeSign({
					sessionId,
					signerId: 'signer-1',
				}),
			).rejects.toThrow('Signing session not found or expired');
		});

		it('returns txHash and signature', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const { sessionId } = await service.createSession({
				signerId: 'signer-1',
				signerFirstMessage: new Uint8Array([1, 2, 3]),
				transaction: makeTransaction(),
			});

			const result = await service.completeSign({
				sessionId,
				signerId: 'signer-1',
			});

			expect(result.txHash).toBe('0xtxhash123');
			expect(result.signature.r).toMatch(/^0x/);
			expect(result.signature.s).toMatch(/^0x/);
			expect([27, 28]).toContain(result.signature.v);
		});
	});

	// -----------------------------------------------------------------------
	// onModuleDestroy
	// -----------------------------------------------------------------------

	describe('onModuleDestroy', () => {
		it('wipes all active sessions', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const s1 = await service.createSession({
				signerId: 'signer-1',
				signerFirstMessage: new Uint8Array([1, 2, 3]),
				transaction: makeTransaction(),
			});
			const s2 = await service.createSession({
				signerId: 'signer-1',
				signerFirstMessage: new Uint8Array([1, 2, 3]),
				transaction: makeTransaction(),
			});

			vi.mocked(cryptoUtils.wipeBuffer).mockClear();

			service.onModuleDestroy();

			// Each session has serverKeyMaterialBytes wiped
			expect(cryptoUtils.wipeBuffer).toHaveBeenCalledTimes(2);

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
					signerFirstMessage: new Uint8Array([1, 2, 3]),
					messageHash: new Uint8Array(32),
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
					signerFirstMessage: new Uint8Array([1, 2, 3]),
					messageHash: new Uint8Array(32),
				}),
			).rejects.toThrow('Signer is paused');
		});

		it('returns session output on success', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const result = await service.createMessageSession({
				signerId: 'signer-1',
				signerFirstMessage: new Uint8Array([1, 2, 3]),
				messageHash: new Uint8Array(32),
			});

			expect(result.sessionId).toBeDefined();
			expect(result.serverFirstMessages).toBeInstanceOf(Array);
			expect(result.messageHash).toBeInstanceOf(Uint8Array);
			expect(result.eid).toBeInstanceOf(Uint8Array);
			expect(result.partyConfig).toBeDefined();
			expect(result.roundsRemaining).toBe(4);
		});
	});
});
