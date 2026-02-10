import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import type { IChain, IVaultStore } from '@agentokratia/guardian-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../../common/authenticated-request.js';
import { SignerController } from '../signer.controller.js';
import type { SignerService } from '../signer.service.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMocks() {
	const vault: IVaultStore = {
		storeShare: vi.fn().mockResolvedValue(undefined),
		getShare: vi.fn().mockResolvedValue(new Uint8Array(0)),
		deleteShare: vi.fn().mockResolvedValue(undefined),
		healthCheck: vi.fn().mockResolvedValue(true),
	};

	const signerService = {
		get: vi.fn().mockResolvedValue({
			id: 'signer-1',
			name: 'Test',
			ethAddress: '0xabc',
			ownerAddress: '0xTestOwner',
			network: 'sepolia',
		}),
		list: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		revoke: vi.fn(),
		pause: vi.fn(),
		resume: vi.fn(),
	};

	const chainRegistry = {
		getChain: vi.fn().mockResolvedValue({ chainId: 11155111, name: 'sepolia', getBalance: vi.fn().mockResolvedValue(0n) }),
		getChainByName: vi.fn().mockResolvedValue({ chainId: 11155111, name: 'sepolia', getBalance: vi.fn().mockResolvedValue(0n) }),
		invalidateCache: vi.fn(),
	};

	const networkService = {
		listEnabled: vi.fn().mockResolvedValue([]),
		getByName: vi.fn(),
		getByChainId: vi.fn(),
	};

	return { vault, signerService, chainRegistry, networkService };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SignerController — user share endpoints', () => {
	let controller: SignerController;
	let mocks: ReturnType<typeof createMocks>;
	const defaultReq = { sessionUser: '0xTestOwner' } as AuthenticatedRequest;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks = createMocks();
		controller = new SignerController(
			mocks.signerService as unknown as SignerService,
			mocks.chainRegistry as any,
			mocks.networkService as any,
			mocks.vault,
			{} as any,
		);
	});

	// -----------------------------------------------------------------------
	// storeUserShare
	// -----------------------------------------------------------------------

	describe('storeUserShare', () => {
		it('verifies signer exists before storing', async () => {
			await controller.storeUserShare('signer-1', {
				walletAddress: '0xwallet',
				iv: 'aXY=',
				ciphertext: 'Y2lwaGVy',
				salt: 'c2FsdA==',
			}, defaultReq);

			expect(mocks.signerService.get).toHaveBeenCalledWith('signer-1');
		});

		it('stores JSON-encoded bytes in Vault at user-encrypted/{id}', async () => {
			const dto = {
				walletAddress: '0xwallet',
				iv: 'aXY=',
				ciphertext: 'Y2lwaGVy',
				salt: 'c2FsdA==',
			};

			await controller.storeUserShare('signer-1', dto, defaultReq);

			expect(mocks.vault.storeShare).toHaveBeenCalledWith(
				'user-encrypted/signer-1',
				expect.any(Uint8Array),
			);

			// Verify the stored bytes are valid JSON matching the DTO
			const calls = (mocks.vault.storeShare as ReturnType<typeof vi.fn>).mock.calls;
			const storedBytes = calls[0]![1] as Uint8Array;
			const storedJson = JSON.parse(new TextDecoder().decode(storedBytes));
			expect(storedJson).toEqual(dto);
		});

		it('returns success on store', async () => {
			const result = await controller.storeUserShare('signer-1', {
				walletAddress: '0xwallet',
				iv: 'aXY=',
				ciphertext: 'Y2lwaGVy',
				salt: 'c2FsdA==',
			}, defaultReq);

			expect(result).toEqual({ success: true });
		});

		it('throws when signer does not exist', async () => {
			(mocks.signerService.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
				new NotFoundException('Signer not found: nonexistent'),
			);

			await expect(
				controller.storeUserShare('nonexistent', {
					walletAddress: '0xwallet',
					iv: 'aXY=',
					ciphertext: 'Y2lwaGVy',
					salt: 'c2FsdA==',
				}, defaultReq),
			).rejects.toThrow('Signer not found');
		});
	});

	// -----------------------------------------------------------------------
	// getUserShare
	// -----------------------------------------------------------------------

	describe('getUserShare', () => {
		it('verifies signer exists before fetching', async () => {
			const dto = {
				walletAddress: '0xtestowner',
				iv: 'aXY=',
				ciphertext: 'Y2lwaGVy',
				salt: 'c2FsdA==',
			};
			const storedBytes = new TextEncoder().encode(JSON.stringify(dto));
			(mocks.vault.getShare as ReturnType<typeof vi.fn>).mockResolvedValueOnce(storedBytes);

			await controller.getUserShare('signer-1', defaultReq);

			expect(mocks.signerService.get).toHaveBeenCalledWith('signer-1');
		});

		it('reads from Vault and returns parsed JSON', async () => {
			const dto = {
				walletAddress: '0xtestowner',
				iv: 'aXY=',
				ciphertext: 'Y2lwaGVy',
				salt: 'c2FsdA==',
			};
			const storedBytes = new TextEncoder().encode(JSON.stringify(dto));
			(mocks.vault.getShare as ReturnType<typeof vi.fn>).mockResolvedValueOnce(storedBytes);

			const result = await controller.getUserShare('signer-1', defaultReq);

			expect(mocks.vault.getShare).toHaveBeenCalledWith(
				'user-encrypted/signer-1',
			);
			expect(result).toEqual(dto);
		});

		it('throws 404 HttpException when Vault has no share', async () => {
			(mocks.vault.getShare as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
				new Error('not found'),
			);

			try {
				await controller.getUserShare('signer-1', defaultReq);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(HttpException);
				expect((error as HttpException).getStatus()).toBe(
					HttpStatus.NOT_FOUND,
				);
				expect((error as HttpException).message).toBe(
					'User share not found',
				);
			}
		});

		it('throws when signer does not exist', async () => {
			(mocks.signerService.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
				new NotFoundException('Signer not found: nonexistent'),
			);

			await expect(
				controller.getUserShare('nonexistent', { sessionUser: '0xwallet' } as never),
			).rejects.toThrow('Signer not found');
		});
	});
});
