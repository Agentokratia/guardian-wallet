import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IShareStore } from '@agentokratia/guardian-core';
import {
	Inject,
	Injectable,
	Logger,
	type OnModuleDestroy,
	type OnModuleInit,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { SHARE_STORE } from '../common/share-store.module.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PoolEntry {
	id: string;
	auxInfoJson: string;
	createdAt: string;
}

interface ManifestData {
	version: number;
	entries: Array<{ id: string; createdAt: string }>;
}

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

const POOL_PREFIX = 'auxinfo-pool';
const MANIFEST_KEY = `${POOL_PREFIX}/_manifest`;
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
 * AuxInfo pool with background regeneration, persisted via share store.
 *
 * AuxInfo = Paillier keypairs + ZK proofs. NOT ECDSA key material.
 * Pre-generating is cryptographically safe per CGGMP24 spec (separable sub-protocol).
 *
 * Security: encrypted at rest via share store, consumed entries deleted synchronously
 * to prevent crash-reuse. Paillier private keys are JS strings (not wipeable) —
 * same limitation as any JS string. Exploitation needs: memory dump + signing
 * transcripts + one ECDSA share.
 */
@Injectable()
export class AuxInfoPoolService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(AuxInfoPoolService.name);
	private readonly pool: PoolEntry[] = [];
	private activeGenerators = 0;
	private monitorTimer: ReturnType<typeof setInterval> | null = null;
	private nativeBinaryPath: string | null = null;

	constructor(
		@Inject(SHARE_STORE) private readonly shareStore: IShareStore,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
	) {}

	// ---- Lifecycle ----

	async onModuleInit(): Promise<void> {
		this.nativeBinaryPath = resolveNativeBinary();
		if (!this.nativeBinaryPath) {
			this.logger.warn('Native binary not found — pool disabled, DKG falls back to cold start');
			return;
		}

		await this.loadPool();
		this.logger.log(
			`AuxInfo pool loaded: ${this.pool.length}/${this.config.AUXINFO_POOL_TARGET} entries`,
		);

		this.monitorTimer = setInterval(() => this.monitorTick(), MONITOR_INTERVAL_MS);
		this.monitorTick();
	}

	onModuleDestroy(): void {
		if (this.monitorTimer) {
			clearInterval(this.monitorTimer);
			this.monitorTimer = null;
		}
		for (const entry of this.pool) {
			entry.auxInfoJson = '';
		}
		this.pool.length = 0;
	}

	// ---- Public API ----

	/**
	 * Consume one AuxInfo entry (FIFO). Returns JSON string or null if empty.
	 *
	 * Deletion is synchronous to prevent crash-reuse — two signers sharing
	 * identical Paillier (N, p, q) would be a cross-contamination risk.
	 */
	async take(): Promise<string | null> {
		const entry = this.pool.shift();
		if (!entry) return null;

		this.logger.log(
			`Pool: consumed ${entry.id} — ${this.pool.length}/${this.config.AUXINFO_POOL_TARGET} remaining`,
		);

		try {
			await this.removeEntry(entry.id);
		} catch (err) {
			this.logger.warn(`Failed to remove pool entry ${entry.id}: ${String(err)}`);
		}

		this.monitorTick();
		return entry.auxInfoJson;
	}

	getStatus(): AuxInfoPoolStatus {
		return {
			size: this.pool.length,
			target: this.config.AUXINFO_POOL_TARGET,
			lowWatermark: this.config.AUXINFO_POOL_LOW_WATERMARK,
			activeGenerators: this.activeGenerators,
			maxGenerators: this.config.AUXINFO_POOL_MAX_GENERATORS,
			healthy: this.pool.length > 0 || !this.nativeBinaryPath,
		};
	}

	// ---- Background Monitor ----

	private monitorTick(): void {
		if (!this.nativeBinaryPath) return;
		if (this.pool.length > this.config.AUXINFO_POOL_LOW_WATERMARK) return;

		const currentSize = this.pool.length + this.activeGenerators;
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

				const entry: PoolEntry = {
					id: `entry-${crypto.randomUUID()}`,
					auxInfoJson,
					createdAt: new Date().toISOString(),
				};

				this.pool.push(entry);
				const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
				this.logger.log(
					`AuxInfo generated in ${elapsed}s. Pool: ${this.pool.length}/${this.config.AUXINFO_POOL_TARGET}`,
				);

				try {
					await this.persistEntry(entry);
				} catch (err) {
					this.logger.warn(`Persist failed for ${entry.id}: ${String(err)} — in-memory only`);
				}
			})
			.catch((err) => {
				this.activeGenerators--;
				this.logger.error(`gen-aux failed: ${String(err)}`);
			});
	}

	private runGenAux(): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			execFile(
				this.nativeBinaryPath!,
				['gen-aux', '3', '1'],
				{ maxBuffer: 50 * 1024 * 1024, timeout: GENERATOR_TIMEOUT_MS },
				(err, stdout, stderr) => {
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
		});
	}

	// ---- Persistence ----

	private async loadPool(): Promise<void> {
		let manifest: ManifestData;
		try {
			const raw = await this.shareStore.getShare(MANIFEST_KEY);
			manifest = JSON.parse(new TextDecoder().decode(raw)) as ManifestData;
		} catch {
			this.logger.debug('No manifest found — starting with empty pool');
			return;
		}

		if (manifest.version !== 1 || !Array.isArray(manifest.entries)) {
			this.logger.warn('Manifest corrupted — starting with empty pool');
			return;
		}

		let loaded = 0;
		for (const meta of manifest.entries) {
			try {
				const raw = await this.shareStore.getShare(`${POOL_PREFIX}/${meta.id}`);
				const auxInfoJson = new TextDecoder().decode(raw);

				if (!isValidAuxInfoJson(auxInfoJson)) {
					this.logger.warn(`Skipping invalid pool entry ${meta.id}`);
					continue;
				}

				this.pool.push({ id: meta.id, auxInfoJson, createdAt: meta.createdAt });
				loaded++;
			} catch (err) {
				this.logger.warn(`Failed to load pool entry ${meta.id}: ${String(err)}`);
			}
		}

		if (loaded !== manifest.entries.length) {
			await this.saveManifest().catch((err) => {
				this.logger.warn(`Failed to reconcile manifest: ${String(err)}`);
			});
		}
	}

	private async saveManifest(): Promise<void> {
		const manifest: ManifestData = {
			version: 1,
			entries: this.pool.map((e) => ({ id: e.id, createdAt: e.createdAt })),
		};
		await this.shareStore.storeShare(
			MANIFEST_KEY,
			new TextEncoder().encode(JSON.stringify(manifest)),
		);
	}

	private async persistEntry(entry: PoolEntry): Promise<void> {
		await this.shareStore.storeShare(
			`${POOL_PREFIX}/${entry.id}`,
			new TextEncoder().encode(entry.auxInfoJson),
		);
		await this.saveManifest();
	}

	private async removeEntry(id: string): Promise<void> {
		await this.shareStore.deleteShare(`${POOL_PREFIX}/${id}`);
		await this.saveManifest();
	}
}
