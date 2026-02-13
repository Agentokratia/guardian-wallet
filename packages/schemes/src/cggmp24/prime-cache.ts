/**
 * DKG acceleration cache — pre-generates expensive Paillier operations.
 *
 * Two cache layers (in priority order):
 *
 * 1. **AuxInfo cache** (`cached_aux_info.txt`) — pre-generated Phase A output.
 *    DKG only needs to run Phase B (keygen) → **~1s**.
 *    Generated in background via `guardian-gen-primes gen-aux`.
 *
 * 2. **Prime cache** (`cached_primes.txt`) — pre-generated Paillier safe primes.
 *    DKG runs both phases but skips prime search → **~15s**.
 *    Fallback when no AuxInfo is available.
 *
 * Strategy:
 * - On startup, load cached AuxInfo + primes from disk
 * - DKG uses AuxInfo if available (fast path), else primes (medium), else cold start
 * - After consumption, replenish AuxInfo in background
 */

import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const POOL_SIZE = 3;

/** Resolve paths relative to the mpc-wasm package. */
function getMpcWasmRoot(): string {
	const thisDir = dirname(fileURLToPath(import.meta.url));
	for (const candidate of [
		resolve(thisDir, '..', '..', '..', 'mpc-wasm'),                 // from schemes/src/cggmp24/ or dist/cggmp24/
		resolve(thisDir, '..', '..', '..', '..', 'mpc-wasm'),          // deeper nesting
		resolve(thisDir, '..', '..', '..', '..', 'packages', 'mpc-wasm'), // fallback
	]) {
		if (existsSync(join(candidate, 'pkg')) || existsSync(join(candidate, 'native-gen'))) {
			return candidate;
		}
	}
	return resolve(process.cwd(), 'packages', 'mpc-wasm');
}

export class PrimeCache {
	/** Raw base64 lines — one per prime set. Piped directly to native binary stdin. */
	private primeLines: string[] = [];
	/** Pre-generated AuxInfo JSON lines — one complete set (all parties) per line. */
	private auxInfoLines: string[] = [];
	private generating = false;
	private mpcWasmRoot: string;
	private cacheFilePath: string;
	private auxInfoCachePath: string;
	private nativeBin: string;

	constructor() {
		this.mpcWasmRoot = getMpcWasmRoot();
		this.cacheFilePath = join(this.mpcWasmRoot, 'pkg', 'cached_primes.txt');
		this.auxInfoCachePath = join(this.mpcWasmRoot, 'pkg', 'cached_aux_info.txt');
		this.nativeBin = join(
			this.mpcWasmRoot,
			'native-gen',
			'target',
			'release',
			'guardian-gen-primes',
		);
	}

	/** Number of cached prime sets available. */
	get available(): number {
		return this.primeLines.length;
	}

	/** Number of cached AuxInfo sets available. */
	get auxInfoAvailable(): number {
		return this.auxInfoLines.length;
	}

	/** Path to the native DKG binary. */
	getNativeBinaryPath(): string {
		return this.nativeBin;
	}

	// ---- AuxInfo cache (fast path: DKG in ~1s) ----

	/**
	 * Load pre-generated AuxInfo from cache file.
	 * Returns the number of AuxInfo sets loaded.
	 */
	loadAuxInfoFromFile(): number {
		try {
			if (!existsSync(this.auxInfoCachePath)) {
				return 0;
			}
			const content = readFileSync(this.auxInfoCachePath, 'utf-8').trim();
			if (!content) return 0;
			this.auxInfoLines = content.split('\n').filter((l) => l.trim().length > 0);
			return this.auxInfoLines.length;
		} catch (err) {
			console.error('[PrimeCache] Failed to load cached aux info:', err);
			return 0;
		}
	}

	/**
	 * Take one pre-generated AuxInfo JSON line for piping to `dkg-with-aux`.
	 * Returns null if none available.
	 */
	takeAuxInfoLine(): string | null {
		if (this.auxInfoLines.length === 0) return null;
		return this.auxInfoLines.shift()!;
	}

	/**
	 * Start generating AuxInfo in background for next DKG.
	 * This pre-runs Phase A (primes + ZK proofs) so DKG only needs keygen.
	 */
	startAuxInfoRegeneration(n: number = 3, count: number = 1): void {
		if (this.generating) return;

		if (!existsSync(this.nativeBin)) {
			console.warn('[PrimeCache] Native binary not found — cannot generate aux info');
			return;
		}

		this.generating = true;
		console.log(`[PrimeCache] Starting background AuxInfo generation (${count} sets, ${n} parties)...`);

		execFile(
			this.nativeBin,
			['gen-aux', String(n), String(count)],
			{ maxBuffer: 50 * 1024 * 1024, timeout: 600_000 },
			(err, stdout, stderr) => {
				this.generating = false;

				if (err) {
					console.error('[PrimeCache] AuxInfo generation failed:', err.message);
					return;
				}

				if (stderr) {
					for (const line of stderr.split('\n').filter((l) => l.trim())) {
						console.log(`[PrimeCache] ${line}`);
					}
				}

				const lines = stdout.trim().split('\n').filter((l) => l.trim().length > 0);
				this.auxInfoLines.push(...lines);

				console.log(`[PrimeCache] Generated ${lines.length} AuxInfo sets (${this.auxInfoLines.length} total)`);

				this.saveAuxInfoCacheFile();
			},
		);
	}

	/** Save AuxInfo cache to disk for next restart. */
	private saveAuxInfoCacheFile(): void {
		try {
			writeFileSync(this.auxInfoCachePath, this.auxInfoLines.join('\n') + '\n', 'utf-8');
		} catch (err) {
			console.error('[PrimeCache] Failed to save aux info:', err);
		}
	}

	// ---- Prime cache (fallback: DKG in ~15s) ----

	/**
	 * Load pre-computed primes from the bundled cache file.
	 * Synchronous — call on server startup.
	 */
	loadFromFile(): number {
		try {
			if (!existsSync(this.cacheFilePath)) {
				console.warn('[PrimeCache] No cached primes file at', this.cacheFilePath);
				return 0;
			}

			const content = readFileSync(this.cacheFilePath, 'utf-8').trim();
			if (!content) return 0;

			this.primeLines = content.split('\n').filter((l) => l.trim().length > 0);
			return this.primeLines.length;
		} catch (err) {
			console.error('[PrimeCache] Failed to load cached primes:', err);
			return 0;
		}
	}

	/**
	 * Take `count` prime lines as raw base64 strings for piping to native binary.
	 * Returns null if not enough are available.
	 */
	takePrimeLines(count: number = POOL_SIZE): string[] | null {
		if (this.primeLines.length < count) return null;
		return this.primeLines.splice(0, count);
	}

	/**
	 * Take `count` cached primes as Uint8Arrays (for WASM path, kept for compatibility).
	 * Returns null if not enough are available.
	 */
	take(count: number = POOL_SIZE): Uint8Array[] | null {
		if (this.primeLines.length < count) return null;
		const taken = this.primeLines.splice(0, count);
		return taken.map((line) => new Uint8Array(Buffer.from(line.trim(), 'base64')));
	}

	/**
	 * Start regenerating primes in background using the native binary.
	 * Non-blocking — returns immediately.
	 */
	startNativeRegeneration(count: number = POOL_SIZE): void {
		if (this.generating) return;

		if (!existsSync(this.nativeBin)) {
			console.warn(
				'[PrimeCache] Native binary not found at',
				this.nativeBin,
				'— cannot regenerate primes',
			);
			return;
		}

		this.generating = true;
		console.log(`[PrimeCache] Starting background prime regeneration (${count} sets)...`);

		execFile(
			this.nativeBin,
			['primes', String(count)],
			{ maxBuffer: 50 * 1024 * 1024, timeout: 600_000 },
			(err, stdout, stderr) => {
				this.generating = false;

				if (err) {
					console.error('[PrimeCache] Prime generation failed:', err.message);
					return;
				}

				if (stderr) {
					for (const line of stderr.split('\n').filter((l) => l.trim())) {
						console.log(`[PrimeCache] ${line}`);
					}
				}

				const lines = stdout.trim().split('\n').filter((l) => l.trim().length > 0);
				this.primeLines.push(...lines);

				console.log(`[PrimeCache] Regenerated ${lines.length} prime sets (${this.primeLines.length} total)`);

				this.saveToCacheFile();
			},
		);
	}

	/** Save current primes to the cache file for next restart. */
	private saveToCacheFile(): void {
		try {
			writeFileSync(this.cacheFilePath, this.primeLines.join('\n') + '\n', 'utf-8');
		} catch (err) {
			console.error('[PrimeCache] Failed to save primes:', err);
		}
	}
}

/** Singleton prime cache instance. */
export const primeCache = new PrimeCache();
