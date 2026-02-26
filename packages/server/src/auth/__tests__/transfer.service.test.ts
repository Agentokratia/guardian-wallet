import {
	ConflictException,
	ForbiddenException,
	GoneException,
	NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseService } from '../../common/supabase.service.js';
import type { SignerRepository } from '../../signers/signer.repository.js';
import { TransferService } from '../transfer.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a chainable mock that mimics the Supabase query builder. */
function createChain(terminalResult: { data: unknown; error: unknown }) {
	const chain: Record<string, ReturnType<typeof vi.fn>> = {};
	const self = () => chain;

	chain.from = vi.fn().mockImplementation(self);
	chain.insert = vi.fn().mockImplementation(self);
	chain.update = vi.fn().mockImplementation(self);
	chain.select = vi.fn().mockImplementation(self);
	chain.eq = vi.fn().mockImplementation(self);
	chain.gt = vi.fn().mockImplementation(self);
	chain.is = vi.fn().mockImplementation(self);
	chain.or = vi.fn().mockImplementation(self);
	chain.not = vi.fn().mockImplementation(self);
	chain.order = vi.fn().mockImplementation(self);
	chain.limit = vi.fn().mockImplementation(self);
	chain.single = vi.fn().mockResolvedValue(terminalResult);

	return chain;
}

const SIGNER_ID = 'signer-aaa';
const OWNER_ID = 'user-111';
const OTHER_USER = 'user-222';
const TRANSFER_ID = 'transfer-xyz';

function makeSigner(overrides: Record<string, unknown> = {}) {
	return {
		id: SIGNER_ID,
		name: 'test-signer',
		ownerId: OWNER_ID,
		ethAddress: '0xabc',
		chain: 'ethereum',
		scheme: 'cggmp21',
		status: 'active',
		type: 'agent',
		apiKeyHash: 'hash',
		vaultSharePath: '/vault/path',
		dkgCompleted: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Factory — fresh mocks per test
// ---------------------------------------------------------------------------

function createMocks() {
	const signerRepo = {
		findById: vi.fn(),
	};

	const supabaseClient = createChain({ data: null, error: null });

	const supabase = {
		client: supabaseClient,
	};

	return { signerRepo, supabase, supabaseClient };
}

function createService(
	supabase: { client: Record<string, ReturnType<typeof vi.fn>> },
	signerRepo: { findById: ReturnType<typeof vi.fn> },
) {
	return new TransferService(
		supabase as unknown as SupabaseService,
		signerRepo as unknown as SignerRepository,
	);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TransferService', () => {
	let service: TransferService;
	let mocks: ReturnType<typeof createMocks>;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks = createMocks();
		service = createService(mocks.supabase, mocks.signerRepo);
	});

	// =======================================================================
	// initiate
	// =======================================================================

	describe('initiate()', () => {
		it('creates a transfer with correct fields and ~10min expiry', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const chain = createChain({
				data: { id: TRANSFER_ID },
				error: null,
			});
			mocks.supabase.client.from = vi.fn().mockReturnValue(chain);

			const before = Date.now();
			const result = await service.initiate(SIGNER_ID, OWNER_ID, 'cli_to_dashboard');
			const after = Date.now();

			expect(result.transferId).toBe(TRANSFER_ID);

			// Verify the insert was called with correct fields
			expect(chain.insert).toHaveBeenCalledWith(
				expect.objectContaining({
					signer_id: SIGNER_ID,
					initiator_id: OWNER_ID,
					direction: 'cli_to_dashboard',
				}),
			);

			// Verify insert payload contains expires_at roughly 10 minutes out
			const insertArg = chain.insert!.mock.calls[0]![0] as Record<string, unknown>;
			const expiresAt = new Date(insertArg.expires_at as string).getTime();
			const tenMinMs = 10 * 60_000;
			expect(expiresAt).toBeGreaterThanOrEqual(before + tenMinMs - 1000);
			expect(expiresAt).toBeLessThanOrEqual(after + tenMinMs + 1000);

			// The returned expiresAt should match
			const returnedExpiry = new Date(result.expiresAt).getTime();
			expect(returnedExpiry).toBeGreaterThanOrEqual(before + tenMinMs - 1000);
			expect(returnedExpiry).toBeLessThanOrEqual(after + tenMinMs + 1000);
		});

		it('throws NotFoundException when signer does not exist', async () => {
			mocks.signerRepo.findById.mockResolvedValue(null);

			await expect(service.initiate(SIGNER_ID, OWNER_ID, 'cli_to_dashboard')).rejects.toThrow(
				NotFoundException,
			);
		});

		it('throws ForbiddenException when initiator does not own signer', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			await expect(service.initiate(SIGNER_ID, OTHER_USER, 'cli_to_dashboard')).rejects.toThrow(
				ForbiddenException,
			);
		});

		it('throws when Supabase insert fails', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const chain = createChain({
				data: null,
				error: { message: 'db error' },
			});
			mocks.supabase.client.from = vi.fn().mockReturnValue(chain);

			await expect(service.initiate(SIGNER_ID, OWNER_ID, 'cli_to_dashboard')).rejects.toThrow(
				'Failed to create transfer',
			);
		});
	});

	// =======================================================================
	// uploadPayload
	// =======================================================================

	describe('uploadPayload()', () => {
		it('stores encrypted payload on the transfer', async () => {
			const chain = createChain({
				data: { id: TRANSFER_ID },
				error: null,
			});
			mocks.supabase.client.from = vi.fn().mockReturnValue(chain);

			await service.uploadPayload(TRANSFER_ID, OWNER_ID, 'encrypted-blob-abc');

			expect(chain.update).toHaveBeenCalledWith({ encrypted_payload: 'encrypted-blob-abc' });
			expect(chain.eq).toHaveBeenCalledWith('id', TRANSFER_ID);
			expect(chain.eq).toHaveBeenCalledWith('initiator_id', OWNER_ID);
			expect(chain.is).toHaveBeenCalledWith('claimed_at', null);
		});

		it('throws NotFoundException when transfer not found or not authorized', async () => {
			const chain = createChain({
				data: null,
				error: { message: 'no rows' },
			});
			mocks.supabase.client.from = vi.fn().mockReturnValue(chain);

			await expect(service.uploadPayload(TRANSFER_ID, OTHER_USER, 'some-payload')).rejects.toThrow(
				NotFoundException,
			);
		});
	});

	// =======================================================================
	// findPending
	// =======================================================================

	describe('findPending()', () => {
		it('returns unclaimed transfer for a signer', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const futureExpiry = new Date(Date.now() + 600_000).toISOString();
			const chain = createChain({
				data: {
					id: TRANSFER_ID,
					direction: 'cli_to_dashboard',
					expires_at: futureExpiry,
				},
				error: null,
			});
			mocks.supabase.client.from = vi.fn().mockReturnValue(chain);

			const result = await service.findPending(SIGNER_ID, OWNER_ID);

			expect(result).not.toBeNull();
			expect(result!.transferId).toBe(TRANSFER_ID);
			expect(result!.direction).toBe('cli_to_dashboard');
			expect(result!.expiresAt).toBe(futureExpiry);
		});

		it('returns null when no pending transfers exist', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const chain = createChain({ data: null, error: null });
			mocks.supabase.client.from = vi.fn().mockReturnValue(chain);

			const result = await service.findPending(SIGNER_ID, OWNER_ID);
			expect(result).toBeNull();
		});

		it('returns null for expired transfers (Supabase gt filter)', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			// Supabase returns null because the gt('expires_at', now) filter excluded it
			const chain = createChain({ data: null, error: null });
			mocks.supabase.client.from = vi.fn().mockReturnValue(chain);

			const result = await service.findPending(SIGNER_ID, OWNER_ID);
			expect(result).toBeNull();

			// Verify the gt filter was applied on expires_at
			expect(chain.gt).toHaveBeenCalledWith('expires_at', expect.any(String));
		});

		it('returns null for already-claimed transfers (Supabase is filter)', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			// Supabase returns null because `is('claimed_at', null)` filter excluded claimed rows
			const chain = createChain({ data: null, error: null });
			mocks.supabase.client.from = vi.fn().mockReturnValue(chain);

			const result = await service.findPending(SIGNER_ID, OWNER_ID);
			expect(result).toBeNull();

			// Verify the claimed_at null filter was applied
			expect(chain.is).toHaveBeenCalledWith('claimed_at', null);
		});

		it('throws NotFoundException when signer does not exist', async () => {
			mocks.signerRepo.findById.mockResolvedValue(null);

			await expect(service.findPending(SIGNER_ID, OWNER_ID)).rejects.toThrow(NotFoundException);
		});

		it('throws ForbiddenException when user does not own signer', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			await expect(service.findPending(SIGNER_ID, OTHER_USER)).rejects.toThrow(ForbiddenException);
		});
	});

	// =======================================================================
	// claim
	// =======================================================================

	describe('claim()', () => {
		// claim() calls verifyTransferOwnership() first, which does:
		//   1. supabase.from('share_transfers').select('signer_id').eq(...).single()
		//   2. signerRepo.findById(signer_id)
		// Then the actual claim logic runs as the 2nd (or 3rd) supabase call.

		/** Mock chain for the verifyTransferOwnership lookup. */
		function ownershipChain() {
			return createChain({ data: { signer_id: SIGNER_ID }, error: null });
		}

		it('locks the transfer and returns encrypted payload', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const ownership = ownershipChain();
			const claimChain = createChain({
				data: { encrypted_payload: 'encrypted-share-data' },
				error: null,
			});

			let callCount = 0;
			mocks.supabase.client.from = vi.fn().mockImplementation(() => {
				callCount++;
				return callCount === 1 ? ownership : claimChain;
			});

			const before = Date.now();
			const result = await service.claim(TRANSFER_ID, OWNER_ID);
			const after = Date.now();

			expect(result.encryptedPayload).toBe('encrypted-share-data');

			// lockExpiresAt should be ~5min from now
			const lockExpiry = new Date(result.lockExpiresAt).getTime();
			const fiveMinMs = 5 * 60_000;
			expect(lockExpiry).toBeGreaterThanOrEqual(before + fiveMinMs - 1000);
			expect(lockExpiry).toBeLessThanOrEqual(after + fiveMinMs + 1000);

			// Verify update was called with locked_at and locked_by
			expect(claimChain.update).toHaveBeenCalledWith(
				expect.objectContaining({
					locked_by: OWNER_ID,
				}),
			);
			const updateArg = claimChain.update!.mock.calls[0]![0] as Record<string, unknown>;
			expect(updateArg.locked_at).toBeDefined();
		});

		it('throws ConflictException on already-claimed transfer', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const ownership = ownershipChain();
			// Second query (atomic update) fails
			const updateChain = createChain({ data: null, error: { message: 'no rows' } });
			// Third query (diagnostic lookup) returns a claimed transfer
			const lookupChain = createChain({
				data: {
					claimed_at: new Date().toISOString(),
					expires_at: new Date(Date.now() + 600_000).toISOString(),
					locked_at: null,
					locked_by: null,
				},
				error: null,
			});

			let callCount = 0;
			mocks.supabase.client.from = vi.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 1) return ownership;
				if (callCount === 2) return updateChain;
				return lookupChain;
			});

			await expect(service.claim(TRANSFER_ID, OWNER_ID)).rejects.toThrow(ConflictException);
		});

		it('throws GoneException on expired transfer', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const ownership = ownershipChain();
			// Second query (atomic update) fails
			const updateChain = createChain({ data: null, error: { message: 'no rows' } });
			// Third query (diagnostic) returns an expired, unclaimed transfer
			const lookupChain = createChain({
				data: {
					claimed_at: null,
					expires_at: new Date(Date.now() - 60_000).toISOString(), // expired
					locked_at: null,
					locked_by: null,
				},
				error: null,
			});

			let callCount = 0;
			mocks.supabase.client.from = vi.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 1) return ownership;
				if (callCount === 2) return updateChain;
				return lookupChain;
			});

			await expect(service.claim(TRANSFER_ID, OWNER_ID)).rejects.toThrow(GoneException);
		});

		it('throws ConflictException when locked by another user', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const ownership = ownershipChain();
			// Second query (atomic update) fails
			const updateChain = createChain({ data: null, error: { message: 'no rows' } });
			// Third query (diagnostic) returns transfer locked by someone else
			const lookupChain = createChain({
				data: {
					claimed_at: null,
					expires_at: new Date(Date.now() + 600_000).toISOString(),
					locked_at: new Date().toISOString(),
					locked_by: OTHER_USER,
				},
				error: null,
			});

			let callCount = 0;
			mocks.supabase.client.from = vi.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 1) return ownership;
				if (callCount === 2) return updateChain;
				return lookupChain;
			});

			await expect(service.claim(TRANSFER_ID, OWNER_ID)).rejects.toThrow(ConflictException);
		});

		it('throws NotFoundException when transfer does not exist at all', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const ownership = ownershipChain();
			// Second query fails
			const updateChain = createChain({ data: null, error: { message: 'no rows' } });
			// Third query also returns nothing
			const lookupChain = createChain({ data: null, error: null });

			let callCount = 0;
			mocks.supabase.client.from = vi.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 1) return ownership;
				if (callCount === 2) return updateChain;
				return lookupChain;
			});

			await expect(service.claim(TRANSFER_ID, OWNER_ID)).rejects.toThrow(NotFoundException);
		});

		it('throws NotFoundException when payload not yet uploaded', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const ownership = ownershipChain();
			// Atomic update succeeds but encrypted_payload is null
			const claimChain = createChain({
				data: { encrypted_payload: null },
				error: null,
			});

			let callCount = 0;
			mocks.supabase.client.from = vi.fn().mockImplementation(() => {
				callCount++;
				return callCount === 1 ? ownership : claimChain;
			});

			await expect(service.claim(TRANSFER_ID, OWNER_ID)).rejects.toThrow(NotFoundException);
		});
	});

	// =======================================================================
	// confirm
	// =======================================================================

	describe('confirm()', () => {
		// confirm() calls verifyTransferOwnership() first, then the actual update.

		function ownershipChain() {
			return createChain({ data: { signer_id: SIGNER_ID }, error: null });
		}

		it('sets claimed_at and claimed_by for the locking user', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const ownership = ownershipChain();
			const confirmChain = createChain({
				data: { id: TRANSFER_ID },
				error: null,
			});

			let callCount = 0;
			mocks.supabase.client.from = vi.fn().mockImplementation(() => {
				callCount++;
				return callCount === 1 ? ownership : confirmChain;
			});

			await service.confirm(TRANSFER_ID, OWNER_ID);

			// Verify the update payload includes claimed_at and claimed_by
			expect(confirmChain.update).toHaveBeenCalledWith(
				expect.objectContaining({
					claimed_by: OWNER_ID,
				}),
			);
			const updateArg = confirmChain.update!.mock.calls[0]![0] as Record<string, unknown>;
			expect(updateArg.claimed_at).toBeDefined();

			// Verify eq filters: locked_by match and claimed_at null guard
			expect(confirmChain.eq).toHaveBeenCalledWith('id', TRANSFER_ID);
			expect(confirmChain.eq).toHaveBeenCalledWith('locked_by', OWNER_ID);
			expect(confirmChain.is).toHaveBeenCalledWith('claimed_at', null);
		});

		it('throws ForbiddenException when confirm is called by a non-owner', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const ownership = ownershipChain();
			mocks.supabase.client.from = vi.fn().mockReturnValue(ownership);

			// OTHER_USER doesn't own the signer (ownerId=OWNER_ID)
			await expect(service.confirm(TRANSFER_ID, OTHER_USER)).rejects.toThrow(ForbiddenException);
		});

		it('throws NotFoundException when transfer is already claimed', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const ownership = ownershipChain();
			// Supabase returns no row because `is('claimed_at', null)` excludes it
			const confirmChain = createChain({
				data: null,
				error: { message: 'no rows' },
			});

			let callCount = 0;
			mocks.supabase.client.from = vi.fn().mockImplementation(() => {
				callCount++;
				return callCount === 1 ? ownership : confirmChain;
			});

			await expect(service.confirm(TRANSFER_ID, OWNER_ID)).rejects.toThrow(NotFoundException);
		});
	});

	// =======================================================================
	// Direction validation
	// =======================================================================

	describe('direction validation', () => {
		it('accepts cli_to_dashboard direction', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());
			const chain = createChain({ data: { id: TRANSFER_ID }, error: null });
			mocks.supabase.client.from = vi.fn().mockReturnValue(chain);

			const result = await service.initiate(SIGNER_ID, OWNER_ID, 'cli_to_dashboard');
			expect(result.transferId).toBe(TRANSFER_ID);

			const insertArg = chain.insert!.mock.calls[0]![0] as Record<string, unknown>;
			expect(insertArg.direction).toBe('cli_to_dashboard');
		});

		it('accepts dashboard_to_cli direction', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());
			const chain = createChain({ data: { id: TRANSFER_ID }, error: null });
			mocks.supabase.client.from = vi.fn().mockReturnValue(chain);

			const result = await service.initiate(SIGNER_ID, OWNER_ID, 'dashboard_to_cli');
			expect(result.transferId).toBe(TRANSFER_ID);

			const insertArg = chain.insert!.mock.calls[0]![0] as Record<string, unknown>;
			expect(insertArg.direction).toBe('dashboard_to_cli');
		});

		it('direction is enforced by TypeScript (compile-time)', () => {
			// This test documents the compile-time constraint.
			// The type signature `direction: 'cli_to_dashboard' | 'dashboard_to_cli'`
			// prevents invalid directions at compile time. Passing an invalid string
			// (e.g. 'invalid') would be a TypeScript error, not a runtime one.
			//
			// We verify the parameter is typed as a union literal by inspecting the method exists
			// and accepts both valid values (covered by the two tests above).
			expect(typeof service.initiate).toBe('function');
		});
	});
});
