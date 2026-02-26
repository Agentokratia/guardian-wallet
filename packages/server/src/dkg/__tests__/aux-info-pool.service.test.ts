import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../common/config.js';
import type { AuxInfoPoolRepository } from '../aux-info-pool.repository.js';
import { AuxInfoPoolService } from '../aux-info-pool.service.js';

function createMockRepo() {
	return {
		insert: vi.fn().mockResolvedValue('uuid-123'),
		claimOne: vi.fn().mockResolvedValue(null),
		countUnclaimed: vi.fn().mockResolvedValue(0),
		pruneOldClaimed: vi.fn().mockResolvedValue(0),
	};
}

function createMockConfig(overrides: Partial<AppConfig> = {}): AppConfig {
	return {
		AUXINFO_POOL_TARGET: 5,
		AUXINFO_POOL_LOW_WATERMARK: 2,
		AUXINFO_POOL_MAX_GENERATORS: 2,
		...overrides,
	} as AppConfig;
}

describe('AuxInfoPoolService', () => {
	let service: AuxInfoPoolService;
	let mockRepo: ReturnType<typeof createMockRepo>;
	let mockConfig: AppConfig;

	beforeEach(() => {
		vi.clearAllMocks();
		mockRepo = createMockRepo();
		mockConfig = createMockConfig();

		service = new AuxInfoPoolService(mockRepo as unknown as AuxInfoPoolRepository, mockConfig);
	});

	describe('take', () => {
		it('returns auxInfoJson from repo.claimOne()', async () => {
			mockRepo.claimOne.mockResolvedValue('{"aux_infos":[1,2,3]}');

			const result = await service.take();

			expect(result).toBe('{"aux_infos":[1,2,3]}');
			expect(mockRepo.claimOne).toHaveBeenCalledTimes(1);
		});

		it('returns null when pool is empty', async () => {
			mockRepo.claimOne.mockResolvedValue(null);

			const result = await service.take();

			expect(result).toBeNull();
		});

		it('decrements cachedPoolSize after successful take', async () => {
			// Simulate pool with entries by setting cachedPoolSize via onModuleInit
			mockRepo.countUnclaimed.mockResolvedValue(3);
			await service.onModuleInit();

			// After take(), monitorTick refreshes from DB (fire-and-forget).
			// Return 2 to simulate the DB reflecting the claim.
			mockRepo.countUnclaimed.mockResolvedValue(2);
			mockRepo.claimOne.mockResolvedValue('{"aux_infos":[1,2,3]}');
			await service.take();

			// Allow fire-and-forget monitorTick refresh to settle
			await vi.waitFor(() => {
				expect(service.getStatus().size).toBe(2);
			});
		});

		it('does not go below 0 on cachedPoolSize', async () => {
			mockRepo.claimOne.mockResolvedValue('{"aux_infos":[1,2,3]}');
			await service.take();

			const status = service.getStatus();
			expect(status.size).toBe(0);
		});
	});

	describe('getStatus', () => {
		it('returns pool status with defaults', () => {
			const status = service.getStatus();

			expect(status).toEqual({
				size: 0,
				target: 5,
				lowWatermark: 2,
				activeGenerators: 0,
				maxGenerators: 2,
				healthy: true, // healthy when nativeBinaryPath is null (pool disabled)
			});
		});

		it('reflects cached size after onModuleInit', async () => {
			mockRepo.countUnclaimed.mockResolvedValue(3);
			await service.onModuleInit();

			const status = service.getStatus();
			expect(status.size).toBe(3);
		});
	});

	describe('generate', () => {
		it('returns { spawned: 0 } when native binary not found', () => {
			const result = service.generate(5);

			expect(result).toEqual({ spawned: 0 });
		});
	});

	describe('onModuleInit', () => {
		it('loads count from repo', async () => {
			mockRepo.countUnclaimed.mockResolvedValue(7);

			await service.onModuleInit();

			// countUnclaimed called at least once during init (monitorTick may also call it)
			expect(mockRepo.countUnclaimed).toHaveBeenCalled();
			expect(service.getStatus().size).toBe(7);
		});
	});

	describe('onModuleDestroy', () => {
		it('clears monitor timer without error', () => {
			expect(() => service.onModuleDestroy()).not.toThrow();
		});
	});
});
