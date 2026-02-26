import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseService } from '../../common/supabase.service.js';
import { AuxInfoPoolRepository } from '../aux-info-pool.repository.js';

function createMockSupabase() {
	const rpc = vi.fn();
	const single = vi.fn();
	const select = vi.fn().mockReturnValue({ single });
	const insert = vi.fn().mockReturnValue({ select });

	// For delete chain: .delete({ count }).not().lt()
	const lt = vi.fn();
	const not = vi.fn().mockReturnValue({ lt });
	const deleteFn = vi.fn().mockReturnValue({ not });

	const client = {
		from: vi.fn().mockReturnValue({ insert, delete: deleteFn }),
		rpc,
	};

	return { client, rpc, insert, select, single, deleteFn, not, lt };
}

describe('AuxInfoPoolRepository', () => {
	let repo: AuxInfoPoolRepository;
	let mock: ReturnType<typeof createMockSupabase>;

	beforeEach(() => {
		mock = createMockSupabase();
		repo = new AuxInfoPoolRepository({
			client: mock.client,
		} as unknown as SupabaseService);
	});

	describe('insert', () => {
		it('inserts a row and returns the UUID', async () => {
			mock.single.mockResolvedValue({
				data: { id: 'uuid-123' },
				error: null,
			});

			const id = await repo.insert('{"aux_infos":[1,2,3]}');

			expect(id).toBe('uuid-123');
			expect(mock.client.from).toHaveBeenCalledWith('auxinfo_pool');
			expect(mock.insert).toHaveBeenCalledWith({
				aux_info_json: '{"aux_infos":[1,2,3]}',
			});
		});

		it('throws on Supabase error', async () => {
			mock.single.mockResolvedValue({
				data: null,
				error: { message: 'insert failed' },
			});

			await expect(repo.insert('bad')).rejects.toThrow('Failed to insert auxinfo pool entry');
		});
	});

	describe('claimOne', () => {
		it('returns aux_info_json from RPC', async () => {
			mock.rpc.mockResolvedValue({
				data: '{"aux_infos":[1,2,3]}',
				error: null,
			});

			const result = await repo.claimOne();

			expect(result).toBe('{"aux_infos":[1,2,3]}');
			expect(mock.rpc).toHaveBeenCalledWith('claim_auxinfo_entry');
		});

		it('returns null when pool is empty', async () => {
			mock.rpc.mockResolvedValue({ data: null, error: null });

			const result = await repo.claimOne();

			expect(result).toBeNull();
		});

		it('throws on RPC error', async () => {
			mock.rpc.mockResolvedValue({
				data: null,
				error: { message: 'rpc failed' },
			});

			await expect(repo.claimOne()).rejects.toThrow('claim_auxinfo_entry RPC failed');
		});
	});

	describe('countUnclaimed', () => {
		it('returns count from RPC', async () => {
			mock.rpc.mockResolvedValue({ data: 5, error: null });

			const count = await repo.countUnclaimed();

			expect(count).toBe(5);
			expect(mock.rpc).toHaveBeenCalledWith('auxinfo_pool_count');
		});

		it('returns 0 on null data', async () => {
			mock.rpc.mockResolvedValue({ data: null, error: null });

			const count = await repo.countUnclaimed();

			expect(count).toBe(0);
		});

		it('throws on RPC error', async () => {
			mock.rpc.mockResolvedValue({
				data: null,
				error: { message: 'count failed' },
			});

			await expect(repo.countUnclaimed()).rejects.toThrow('auxinfo_pool_count RPC failed');
		});
	});

	describe('pruneOldClaimed', () => {
		it('deletes old claimed entries and returns count', async () => {
			mock.lt.mockResolvedValue({ count: 3, error: null });

			const count = await repo.pruneOldClaimed();

			expect(count).toBe(3);
			expect(mock.client.from).toHaveBeenCalledWith('auxinfo_pool');
			expect(mock.deleteFn).toHaveBeenCalledWith({ count: 'exact' });
			expect(mock.not).toHaveBeenCalledWith('claimed_at', 'is', null);
		});

		it('returns 0 when no old entries', async () => {
			mock.lt.mockResolvedValue({ count: 0, error: null });

			const count = await repo.pruneOldClaimed();

			expect(count).toBe(0);
		});

		it('throws on Supabase error', async () => {
			mock.lt.mockResolvedValue({
				count: null,
				error: { message: 'delete failed' },
			});

			await expect(repo.pruneOldClaimed()).rejects.toThrow('Failed to prune old claimed entries');
		});
	});
});
