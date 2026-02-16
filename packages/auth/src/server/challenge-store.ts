import type { ChallengeData } from '../shared/types.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_CHALLENGES = 1000;

export interface ChallengeStoreOptions {
	ttlMs?: number;
	maxChallenges?: number;
}

/**
 * In-memory challenge store with TTL-based expiry.
 * Framework-agnostic — no NestJS decorators.
 * Wrap in a NestJS provider at the server level if needed.
 */
export class ChallengeStore {
	private readonly store = new Map<string, ChallengeData>();
	private readonly ttlMs: number;
	private readonly maxChallenges: number;

	constructor(options?: ChallengeStoreOptions) {
		this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
		this.maxChallenges = options?.maxChallenges ?? DEFAULT_MAX_CHALLENGES;
	}

	/** Store a challenge keyed by an identifier (e.g. "reg:{userId}" or "auth:{email}"). */
	set(key: string, challenge: string): void {
		this.cleanup();
		if (this.store.size >= this.maxChallenges) {
			throw new Error('Challenge store is full. Try again later.');
		}
		this.store.set(key, { challenge, userId: key, createdAt: Date.now() });
	}

	/** Retrieve a challenge string. Returns null if expired or missing. */
	get(key: string): string | null {
		this.cleanup();
		const entry = this.store.get(key);
		if (!entry) return null;
		if (Date.now() - entry.createdAt > this.ttlMs) {
			this.store.delete(key);
			return null;
		}
		return entry.challenge;
	}

	/** Consume (retrieve and delete) a challenge string. */
	consume(key: string): string | null {
		const challenge = this.get(key);
		if (challenge) {
			this.store.delete(key);
		}
		return challenge;
	}

	/** Delete a specific challenge. */
	delete(key: string): void {
		this.store.delete(key);
	}

	/** Remove all expired entries. */
	cleanup(): void {
		const now = Date.now();
		for (const [key, entry] of this.store) {
			if (now - entry.createdAt > this.ttlMs) {
				this.store.delete(key);
			}
		}
	}

	/** Number of active (non-expired) challenges. */
	get size(): number {
		this.cleanup();
		return this.store.size;
	}
}
