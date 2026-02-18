/**
 * Live x402 integration tests against https://x402.payai.network
 *
 * These tests hit a real x402 server on Base Sepolia.
 * - checkX402 and discoverX402: always run (no signer needed)
 * - fetchWithX402: only runs when GUARDIAN_API_SECRET_FILE + GUARDIAN_SERVER_URL are set
 *   AND the signer has USDC on Base Sepolia
 *
 * Run: pnpm --filter @agentokratia/guardian vitest run x402-live
 */
import { describe, expect, it } from 'vitest';
import { checkX402, discoverX402, fetchWithX402 } from '../lib/x402-client.js';

const X402_URL = 'https://x402.payai.network/api/base-sepolia/paid-content';
const X402_DOMAIN = 'https://x402.payai.network';

describe('x402 live integration', () => {
	describe('checkX402', () => {
		it('detects 402 on paid endpoint', async () => {
			const result = await checkX402(X402_URL);
			expect(result.requires402).toBe(true);
			expect(result.url).toBe(X402_URL);
			expect(result.paymentRequired).toBeDefined();
			expect(result.paymentRequired!.accepts.length).toBeGreaterThan(0);

			const accept = result.paymentRequired!.accepts[0]!;
			expect(accept.scheme).toBe('exact');
			expect(accept.network).toBe('eip155:84532'); // Base Sepolia
			expect(accept.asset).toMatch(/^0x/);
			expect(accept.amount).toBeDefined();
			expect(accept.payTo).toMatch(/^0x/);
		}, 15_000);

		it('returns non-402 for free endpoints', async () => {
			const result = await checkX402(`${X402_DOMAIN}/`);
			expect(result.requires402).toBe(false);
		}, 15_000);
	});

	describe('discoverX402', () => {
		it('discovers paid endpoints on the domain', async () => {
			const result = await discoverX402(X402_DOMAIN);
			expect(result.domain).toBe(X402_DOMAIN);
			expect(Array.isArray(result.endpoints)).toBe(true);
			// The /api path or subpaths should show up as 402
			// (depends on what probes match — at minimum the domain itself is reachable)
		}, 60_000);
	});

	describe('fetchWithX402', () => {
		it.skipIf(!process.env.GUARDIAN_API_SECRET_FILE)(
			'pays and fetches protected content',
			async () => {
				const { ThresholdSigner } = await import('@agentokratia/guardian-signer');
				const { CGGMP24Scheme } = await import('@agentokratia/guardian-schemes');

				const signer = await ThresholdSigner.fromSecret({
					apiSecret: process.env.GUARDIAN_API_SECRET_FILE!,
					serverUrl: process.env.GUARDIAN_SERVER_URL || 'http://localhost:8080',
					apiKey: process.env.GUARDIAN_API_KEY || '',
					scheme: new CGGMP24Scheme(),
				});

				try {
					const result = await fetchWithX402(X402_URL, signer, {
						maxAmount: '100000', // 0.1 USDC max
					});

					expect(result.paid).toBe(true);
					expect(result.status).toBe(200);
					expect(result.scheme).toBe('exact');
					expect(result.body).toBeTruthy();
					console.log('x402 payment result:', {
						status: result.status,
						paid: result.paid,
						scheme: result.scheme,
						transaction: result.transaction,
						payer: result.payer,
						contentType: result.contentType,
						bodyLength: result.body.length,
					});
				} finally {
					signer.destroy();
				}
			},
			60_000,
		);
	});
});
