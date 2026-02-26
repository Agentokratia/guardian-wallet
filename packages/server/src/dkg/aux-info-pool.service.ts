import { type ChildProcess, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	Inject,
	Injectable,
	Logger,
	type OnModuleDestroy,
	type OnModuleInit,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { AuxInfoPoolRepository } from './aux-info-pool.repository.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuxInfoPoolStatus {
	size: number;
	target: number;
	lowWatermark: number;
	activeGenerators: number;
	maxGenerators: number;
	healthy: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MONITOR_INTERVAL_MS = 30_000;
const GENERATOR_TIMEOUT_MS = 600_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Validate gen-aux JSON output: must have aux_infos array with >= 3 entries. */
function isValidAuxInfoJson(json: string): boolean {
	try {
		const parsed = JSON.parse(json) as { aux_infos?: unknown[] };
		return Array.isArray(parsed.aux_infos) && parsed.aux_infos.length >= 3;
	} catch {
		return false;
	}
}

function resolveNativeBinary(): string | null {
	const thisDir = dirname(fileURLToPath(import.meta.url));
	for (const candidate of [
		resolve(thisDir, '..', '..', '..', 'mpc-wasm'),
		resolve(thisDir, '..', '..', '..', '..', 'mpc-wasm'),
		resolve(thisDir, '..', '..', '..', '..', 'packages', 'mpc-wasm'),
		resolve(process.cwd(), 'packages', 'mpc-wasm'),
	]) {
		const binPath = join(candidate, 'native-gen', 'target', 'release', 'guardian-gen-primes');
		if (existsSync(binPath)) {
			return binPath;
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// AuxInfoPoolService
// ---------------------------------------------------------------------------

/**
 * AuxInfo pool with background regeneration, persisted in PostgreSQL.
 *
 * AuxInfo = Paillier keypairs + ZK proofs. NOT ECDSA key material.
 * Pre-generating is cryptographically safe per CGGMP24 spec (separable sub-protocol).
 *
 * Pool entries persist across restarts and support atomic claiming across
 * multiple server instances via FOR UPDATE SKIP LOCKED.
 */
@Injectable()
export class AuxInfoPoolService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(AuxInfoPoolService.name);
	private cachedPoolSize = 0;
	private activeGenerators = 0;
	private monitorTimer: ReturnType<typeof setInterval> | null = null;
	private nativeBinaryPath: string | null = null;
	private readonly activeChildren = new Set<ChildProcess>();

	constructor(
		@Inject(AuxInfoPoolRepository) private readonly repo: AuxInfoPoolRepository,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
	) {}

	// ---- Lifecycle ----

	async onModuleInit(): Promise<void> {
		this.nativeBinaryPath = resolveNativeBinary();

		// Always load current pool size — useful for monitoring even when generator is disabled
		this.cachedPoolSize = await this.repo.countUnclaimed();

		if (!this.nativeBinaryPath) {
			this.logger.warn('Native binary not found — pool disabled, DKG falls back to cold start');
			return;
		}

		this.logger.log(
			`AuxInfo pool loaded: ${this.cachedPoolSize}/${this.config.AUXINFO_POOL_TARGET} entries`,
		);

		this.monitorTimer = setInterval(() => this.monitorTick(), MONITOR_INTERVAL_MS);
		this.monitorTick();
	}

	onModuleDestroy(): void {
		if (this.monitorTimer) {
			clearInterval(this.monitorTimer);
			this.monitorTimer = null;
		}
		// Kill all running generator child processes to prevent orphans on restart
		for (const child of this.activeChildren) {
			child.kill('SIGTERM');
		}
		this.activeChildren.clear();
		this.activeGenerators = 0;
	}

	// ---- Public API ----

	/**
	 * Consume one AuxInfo entry (FIFO, atomic). Returns JSON string or null if empty.
	 *
	 * Uses FOR UPDATE SKIP LOCKED in the DB — safe across multiple instances.
	 */
	async take(): Promise<string | null> {
		const auxInfoJson = await this.repo.claimOne();
		if (!auxInfoJson) return null;

		this.cachedPoolSize = Math.max(0, this.cachedPoolSize - 1);
		this.logger.log(
			`Pool: consumed entry — ~${this.cachedPoolSize}/${this.config.AUXINFO_POOL_TARGET} remaining`,
		);

		this.monitorTick();
		return auxInfoJson;
	}

	getStatus(): AuxInfoPoolStatus {
		return {
			size: this.cachedPoolSize,
			target: this.config.AUXINFO_POOL_TARGET,
			lowWatermark: this.config.AUXINFO_POOL_LOW_WATERMARK,
			activeGenerators: this.activeGenerators,
			maxGenerators: this.config.AUXINFO_POOL_MAX_GENERATORS,
			// Unhealthy only when pool is stuck: empty, no generators running, and binary exists.
			// size=0 with active generators is normal (filling up) — don't trigger K8s restart.
			healthy: this.cachedPoolSize > 0 || this.activeGenerators > 0 || !this.nativeBinaryPath,
		};
	}

	/**
	 * Batch-generate pool entries. For CLI pre-fill before launches.
	 * Returns the number of generators spawned.
	 */
	generate(count: number): { spawned: number } {
		if (!this.nativeBinaryPath || count <= 0) return { spawned: 0 };

		const slots = this.config.AUXINFO_POOL_MAX_GENERATORS - this.activeGenerators;
		const toSpawn = Math.min(count, slots);

		for (let i = 0; i < toSpawn; i++) {
			this.spawnGenerator();
		}

		return { spawned: toSpawn };
	}

	// ---- Background Monitor ----

	private monitorTick(): void {
		if (!this.nativeBinaryPath) return;

		// Refresh cached pool size from DB every tick (every 30s)
		this.repo
			.countUnclaimed()
			.then((count) => {
				this.cachedPoolSize = count;
			})
			.catch((err) => {
				this.logger.warn(`Failed to refresh pool count: ${String(err)}`);
			});

		// Prune claimed entries older than 7 days
		this.repo.pruneOldClaimed().catch((err) => {
			this.logger.debug(`Prune old claimed entries: ${String(err)}`);
		});

		if (this.cachedPoolSize > this.config.AUXINFO_POOL_LOW_WATERMARK) return;

		const currentSize = this.cachedPoolSize + this.activeGenerators;
		if (currentSize >= this.config.AUXINFO_POOL_TARGET) return;

		const deficit = this.config.AUXINFO_POOL_TARGET - currentSize;
		const slots = this.config.AUXINFO_POOL_MAX_GENERATORS - this.activeGenerators;
		const toSpawn = Math.min(deficit, slots);

		for (let i = 0; i < toSpawn; i++) {
			this.spawnGenerator();
		}
	}

	// ---- Generator ----

	private spawnGenerator(): void {
		this.activeGenerators++;
		const startTime = Date.now();

		this.runGenAux()
			.then(async (auxInfoJson) => {
				this.activeGenerators--;

				if (!isValidAuxInfoJson(auxInfoJson)) {
					this.logger.error('gen-aux produced invalid output');
					return;
				}

				try {
					await this.repo.insert(auxInfoJson);
					this.cachedPoolSize++;
					const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
					this.logger.log(
						`AuxInfo generated in ${elapsed}s. Pool: ~${this.cachedPoolSize}/${this.config.AUXINFO_POOL_TARGET}`,
					);
				} catch (err) {
					this.logger.error(`Failed to persist auxinfo entry: ${String(err)}`);
				}
			})
			.catch((err) => {
				this.activeGenerators--;
				this.logger.error(`gen-aux failed: ${String(err)}`);
			});
	}

	private runGenAux(): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const child = execFile(
				this.nativeBinaryPath as string,
				['gen-aux', '3', '1'],
				{ maxBuffer: 50 * 1024 * 1024, timeout: GENERATOR_TIMEOUT_MS },
				(err, stdout, stderr) => {
					this.activeChildren.delete(child);
					if (stderr) {
						for (const line of stderr.split('\n').filter((l) => l.trim())) {
							this.logger.debug(`[gen-aux] ${line}`);
						}
					}
					if (err) {
						reject(new Error(`gen-aux failed: ${err.message}`));
						return;
					}
					resolve(stdout.trim());
				},
			);
			this.activeChildren.add(child);
		});
	}
}
