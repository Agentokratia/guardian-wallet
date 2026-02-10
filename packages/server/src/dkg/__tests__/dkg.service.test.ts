import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { IVaultStore, Signer } from '@agentokratia/guardian-core';
import {
	ChainName,
	NetworkName,
	SchemeName,
	SignerStatus,
	SignerType,
} from '@agentokratia/guardian-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as cryptoUtils from '../../common/crypto-utils.js';
import type { SignerRepository } from '../../signers/signer.repository.js';
import { DKGService } from '../dkg.service.js';

// ---------------------------------------------------------------------------
// Mock DKLs23Scheme and WASM dependencies
// ---------------------------------------------------------------------------

const mockScheme = {
	dkg: vi.fn(),
	deriveAddress: vi.fn().mockReturnValue('0xDerivedAddress123'),
};

vi.mock('@agentokratia/guardian-schemes', () => ({
	DKLs23Scheme: vi.fn(() => mockScheme),
}));

// Spy on wipeBuffer
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

function makeSigner(overrides: Partial<Signer> = {}): Signer {
	return {
		id: 'signer-1',
		name: 'Test Agent',
		type: SignerType.AI_AGENT,
		ethAddress: '',
		chain: ChainName.ETHEREUM,
		scheme: SchemeName.CGGMP21,
		network: NetworkName.SEPOLIA,
		status: SignerStatus.ACTIVE,
		ownerAddress: '0xTestOwner',
		apiKeyHash: 'hash123',
		vaultSharePath: '',
		dkgCompleted: false,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

function createMocks() {
	const signerRepo = {
		findById: vi.fn(),
		findByApiKeyHash: vi.fn(),
		findAll: vi.fn(),
		create: vi.fn(),
		update: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn(),
	};

	const vault = {
		getShare: vi.fn(),
		storeShare: vi.fn().mockResolvedValue(undefined),
		deleteShare: vi.fn(),
	};

	return { signerRepo, vault };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DKGService', () => {
	let service: DKGService;
	let mocks: ReturnType<typeof createMocks>;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks = createMocks();

		service = new DKGService(
			mocks.signerRepo as unknown as SignerRepository,
			mocks.vault as unknown as IVaultStore,
		);
	});

	// -----------------------------------------------------------------------
	// init
	// -----------------------------------------------------------------------

	describe('init', () => {
		it('throws NotFoundException when signer does not exist', async () => {
			mocks.signerRepo.findById.mockResolvedValue(null);

			await expect(service.init({ signerId: 'nonexistent' })).rejects.toThrow(
				NotFoundException,
			);
		});

		it('creates a new session and returns sessionId', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());
			mockScheme.dkg.mockResolvedValue({
				outgoing: [new Uint8Array([1, 2, 3])],
				finished: false,
			});

			const result = await service.init({ signerId: 'signer-1' });

			expect(result.sessionId).toBeDefined();
			expect(result.signerId).toBe('signer-1');
			expect(result.round).toBe(1);
		});
	});

	// -----------------------------------------------------------------------
	// finalize (runs rounds 2-5 internally)
	// -----------------------------------------------------------------------

	describe('finalize', () => {
		it('throws NotFoundException when signer does not exist', async () => {
			mocks.signerRepo.findById.mockResolvedValue(null);

			await expect(
				service.finalize({
					sessionId: 'session-1',
					signerId: 'nonexistent',
				}),
			).rejects.toThrow(NotFoundException);
		});

		it('throws BadRequestException when no pending session exists', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			await expect(
				service.finalize({
					sessionId: 'nonexistent-session',
					signerId: 'signer-1',
				}),
			).rejects.toThrow(BadRequestException);
		});

		it('runs all 5 DKG rounds and stores server share in vault', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			// Round 1 (init)
			mockScheme.dkg.mockResolvedValueOnce({
				outgoing: [new Uint8Array([1, 2, 3])],
				finished: false,
			});
			const initResult = await service.init({ signerId: 'signer-1' });

			// Rounds 2-4: return outgoing, not finished
			for (let i = 0; i < 3; i++) {
				mockScheme.dkg.mockResolvedValueOnce({
					outgoing: [new Uint8Array([10 + i])],
					finished: false,
				});
			}
			// Round 5: finished with shares
			const serverShare = new Uint8Array([7, 8, 9]);
			mockScheme.dkg.mockResolvedValueOnce({
				outgoing: [],
				finished: true,
				shares: [new Uint8Array([1, 2, 3]), serverShare, new Uint8Array([4, 5, 6])],
				publicKey: new Uint8Array([10, 20]),
			});

			await service.finalize({
				sessionId: initResult.sessionId,
				signerId: 'signer-1',
			});

			// scheme.dkg called 5 times total: round 1 in init + rounds 2-5 in finalize
			expect(mockScheme.dkg).toHaveBeenCalledTimes(5);
			expect(mocks.vault.storeShare).toHaveBeenCalledWith('signer-1', serverShare);
		});

		it('throws BadRequestException when DKG does not complete after round 5', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			// Round 1 (init)
			mockScheme.dkg.mockResolvedValueOnce({
				outgoing: [new Uint8Array([1])],
				finished: false,
			});
			const initResult = await service.init({ signerId: 'signer-1' });

			// All rounds 2-5 return not finished
			for (let i = 0; i < 4; i++) {
				mockScheme.dkg.mockResolvedValueOnce({
					outgoing: [],
					finished: false,
				});
			}

			await expect(
				service.finalize({
					sessionId: initResult.sessionId,
					signerId: 'signer-1',
				}),
			).rejects.toThrow('DKG did not complete');
		});

		it('throws BadRequestException when fewer than 3 shares', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			mockScheme.dkg.mockResolvedValueOnce({
				outgoing: [new Uint8Array([1])],
				finished: false,
			});
			const initResult = await service.init({ signerId: 'signer-1' });

			// Rounds 2-4
			for (let i = 0; i < 3; i++) {
				mockScheme.dkg.mockResolvedValueOnce({
					outgoing: [new Uint8Array([10])],
					finished: false,
				});
			}
			// Round 5 with only 2 shares
			mockScheme.dkg.mockResolvedValueOnce({
				outgoing: [],
				finished: true,
				shares: [new Uint8Array([1]), new Uint8Array([2])],
				publicKey: new Uint8Array([99]),
			});

			await expect(
				service.finalize({
					sessionId: initResult.sessionId,
					signerId: 'signer-1',
				}),
			).rejects.toThrow('Expected 3 shares');
		});

		it('updates signer record with ethAddress and dkgCompleted', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			mockScheme.dkg.mockResolvedValueOnce({
				outgoing: [new Uint8Array([1])],
				finished: false,
			});
			const initResult = await service.init({ signerId: 'signer-1' });

			for (let i = 0; i < 3; i++) {
				mockScheme.dkg.mockResolvedValueOnce({
					outgoing: [new Uint8Array([10])],
					finished: false,
				});
			}
			mockScheme.dkg.mockResolvedValueOnce({
				outgoing: [],
				finished: true,
				shares: [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])],
				publicKey: new Uint8Array([10]),
			});

			await service.finalize({
				sessionId: initResult.sessionId,
				signerId: 'signer-1',
			});

			expect(mocks.signerRepo.update).toHaveBeenCalledWith('signer-1', {
				ethAddress: '0xDerivedAddress123',
				dkgCompleted: true,
				vaultSharePath: 'signer-1',
			});
		});

		it('returns signerShare and userShare as base64', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const signerShareExpectedB64 = Buffer.from(new Uint8Array([1, 2, 3])).toString('base64');

			mockScheme.dkg.mockResolvedValueOnce({
				outgoing: [new Uint8Array([1])],
				finished: false,
			});
			const initResult = await service.init({ signerId: 'signer-1' });

			for (let i = 0; i < 3; i++) {
				mockScheme.dkg.mockResolvedValueOnce({
					outgoing: [new Uint8Array([10])],
					finished: false,
				});
			}
			mockScheme.dkg.mockResolvedValueOnce({
				outgoing: [],
				finished: true,
				shares: [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6]), new Uint8Array([7, 8, 9])],
				publicKey: new Uint8Array([10]),
			});

			const result = await service.finalize({
				sessionId: initResult.sessionId,
				signerId: 'signer-1',
			});

			expect(result.ethAddress).toBe('0xDerivedAddress123');
			expect(result.signerShare).toBe(signerShareExpectedB64);
			expect(typeof result.userShare).toBe('string');
		});

		it('wipes all share buffers in finally block', async () => {
			const signerShare = new Uint8Array([1, 2, 3]);
			const serverShare = new Uint8Array([4, 5, 6]);
			const userShare = new Uint8Array([7, 8, 9]);
			const publicKey = new Uint8Array([10, 20]);

			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			mockScheme.dkg.mockResolvedValueOnce({
				outgoing: [new Uint8Array([1])],
				finished: false,
			});
			const initResult = await service.init({ signerId: 'signer-1' });

			for (let i = 0; i < 3; i++) {
				mockScheme.dkg.mockResolvedValueOnce({
					outgoing: [new Uint8Array([10])],
					finished: false,
				});
			}
			mockScheme.dkg.mockResolvedValueOnce({
				outgoing: [],
				finished: true,
				shares: [signerShare, serverShare, userShare],
				publicKey,
			});

			await service.finalize({
				sessionId: initResult.sessionId,
				signerId: 'signer-1',
			});

			// 4 calls: serverShare, signerShare, userShare, publicKey
			expect(cryptoUtils.wipeBuffer).toHaveBeenCalledWith(signerShare);
			expect(cryptoUtils.wipeBuffer).toHaveBeenCalledWith(serverShare);
			expect(cryptoUtils.wipeBuffer).toHaveBeenCalledWith(userShare);
			expect(cryptoUtils.wipeBuffer).toHaveBeenCalledWith(publicKey);
		});

		it('wipes buffers even when vault store fails', async () => {
			const signerShare = new Uint8Array([1, 2, 3]);
			const serverShare = new Uint8Array([4, 5, 6]);
			const userShare = new Uint8Array([7, 8, 9]);
			const publicKey = new Uint8Array([10, 20]);

			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			mockScheme.dkg.mockResolvedValueOnce({
				outgoing: [new Uint8Array([1])],
				finished: false,
			});
			const initResult = await service.init({ signerId: 'signer-1' });

			for (let i = 0; i < 3; i++) {
				mockScheme.dkg.mockResolvedValueOnce({
					outgoing: [new Uint8Array([10])],
					finished: false,
				});
			}
			mockScheme.dkg.mockResolvedValueOnce({
				outgoing: [],
				finished: true,
				shares: [signerShare, serverShare, userShare],
				publicKey,
			});
			mocks.vault.storeShare.mockRejectedValue(new Error('Vault down'));

			await expect(
				service.finalize({
					sessionId: initResult.sessionId,
					signerId: 'signer-1',
				}),
			).rejects.toThrow('Vault down');

			// Buffers still wiped despite error
			expect(cryptoUtils.wipeBuffer).toHaveBeenCalledWith(serverShare);
			expect(cryptoUtils.wipeBuffer).toHaveBeenCalledWith(signerShare);
			expect(cryptoUtils.wipeBuffer).toHaveBeenCalledWith(userShare);
		});
	});
});
