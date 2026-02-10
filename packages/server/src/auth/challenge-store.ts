import { Injectable } from '@nestjs/common';

interface ChallengeEntry {
	challenge: string;
	createdAt: number;
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CHALLENGES = 1000;

@Injectable()
export class ChallengeStore {
	private readonly store = new Map<string, ChallengeEntry>();

	set(key: string, challenge: string): void {
		this.cleanup();
		if (this.store.size >= MAX_CHALLENGES) {
			throw new Error('Challenge store is full. Try again later.');
		}
		this.store.set(key, { challenge, createdAt: Date.now() });
	}

	get(key: string): string | null {
		this.cleanup();
		const entry = this.store.get(key);
		if (!entry) return null;
		if (Date.now() - entry.createdAt > CHALLENGE_TTL_MS) {
			this.store.delete(key);
			return null;
		}
		return entry.challenge;
	}

	delete(key: string): void {
		this.store.delete(key);
	}

	cleanup(): void {
		const now = Date.now();
		for (const [key, entry] of this.store) {
			if (now - entry.createdAt > CHALLENGE_TTL_MS) {
				this.store.delete(key);
			}
		}
	}
}
