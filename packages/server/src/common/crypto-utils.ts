import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const API_KEY_PREFIX = 'gw_live_';

export function hashApiKey(apiKey: string): string {
	return createHash('sha256').update(apiKey).digest('hex');
}

export function generateApiKey(): string {
	const random = randomBytes(32).toString('base64url');
	return `${API_KEY_PREFIX}${random}`;
}

/** Constant-time string comparison. Returns true if both strings are equal. */
export function timingSafeCompare(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	return timingSafeEqual(Buffer.from(a, 'utf-8'), Buffer.from(b, 'utf-8'));
}

export function wipeBuffer(buf: Uint8Array): void {
	buf.fill(0);
}
