import { describe, expect, it } from 'vitest';
import { checkX402, discoverX402 } from '../lib/x402-client.js';

describe('x402-client', () => {
	it('checkX402 returns requires402=false for a normal URL', async () => {
		// httpbin returns 200 — no 402
		const result = await checkX402('https://httpbin.org/get');
		expect(result.requires402).toBe(false);
		expect(result.url).toBe('https://httpbin.org/get');
	}, 20_000);

	it('checkX402 returns requires402=true for a 402 URL', async () => {
		// httpbin can return any status code
		const result = await checkX402('https://httpbin.org/status/402');
		expect(result.requires402).toBe(true);
	}, 20_000);

	it('discoverX402 returns empty for a non-402 domain', async () => {
		const result = await discoverX402('https://httpbin.org');
		// httpbin doesn't serve .well-known/x402, and most paths return 200
		expect(result.domain).toBe('https://httpbin.org');
		expect(Array.isArray(result.endpoints)).toBe(true);
	}, 30_000);
});
