import { createHash, randomBytes } from 'node:crypto';

const API_KEY_PREFIX = 'gw_live_';

export function hashApiKey(apiKey: string): string {
	return createHash('sha256').update(apiKey).digest('hex');
}

export function generateApiKey(): string {
	const random = randomBytes(32).toString('base64url');
	return `${API_KEY_PREFIX}${random}`;
}

export function wipeBuffer(buf: Uint8Array): void {
	buf.fill(0);
}
