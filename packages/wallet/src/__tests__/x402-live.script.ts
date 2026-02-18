#!/usr/bin/env tsx
/**
 * Live x402 integration script against https://x402.payai.network
 *
 * Tests: checkX402, discoverX402, fetchWithX402
 *
 * Usage:
 *   npx tsx packages/wallet/src/__tests__/x402-live.script.ts
 *   npx tsx packages/wallet/src/__tests__/x402-live.script.ts --pay   # actually pay
 */
import { checkX402, discoverX402, fetchWithX402 } from '../lib/x402-client.js';

const X402_URL = 'https://x402.payai.network/api/base-sepolia/paid-content';
const X402_DOMAIN = 'https://x402.payai.network';

const doPay = process.argv.includes('--pay');

async function main() {
	console.log('=== x402 Live Integration Test ===\n');

	// ── 1. checkX402 ──
	console.log('1. checkX402:', X402_URL);
	const check = await checkX402(X402_URL);
	console.log('   requires402:', check.requires402);
	if (check.paymentRequired) {
		for (const a of check.paymentRequired.accepts) {
			console.log('   accept:', {
				scheme: a.scheme,
				network: a.network,
				amount: a.amount,
				asset: a.asset,
				payTo: a.payTo,
			});
			if (a.extra) {
				console.log('   extra:', a.extra);
			}
		}
	}
	console.log('   ✓ checkX402 passed\n');

	// ── 2. checkX402 on free URL ──
	const freeUrl = `${X402_DOMAIN}/`;
	console.log('2. checkX402 (free):', freeUrl);
	const checkFree = await checkX402(freeUrl);
	console.log('   requires402:', checkFree.requires402);
	console.log('   ✓ free endpoint check passed\n');

	// ── 3. discoverX402 ──
	console.log('3. discoverX402:', X402_DOMAIN);
	const discover = await discoverX402(X402_DOMAIN);
	console.log('   found', discover.endpoints.length, 'endpoint(s)');
	for (const ep of discover.endpoints) {
		console.log('  ', ep.method, ep.path, '→', ep.scheme, ep.network, ep.amount);
	}
	console.log('   ✓ discoverX402 passed\n');

	// ── 4. fetchWithX402 (only with --pay) ──
	if (!doPay) {
		console.log('4. fetchWithX402: SKIPPED (pass --pay to actually pay)\n');
		console.log('=== All read-only tests passed ===');
		return;
	}

	console.log('4. fetchWithX402:', X402_URL);
	const { ThresholdSigner } = await import('@agentokratia/guardian-signer');
	const { CGGMP24Scheme } = await import('@agentokratia/guardian-schemes');
	const { readFileSync } = await import('node:fs');

	// Load config from ~/.gw/config.json
	const configPath = `${process.env.HOME}/.gw/config.json`;
	const config = JSON.parse(readFileSync(configPath, 'utf-8'));

	console.log('   Loading signer from:', config.apiSecretFile);
	const apiSecret = readFileSync(config.apiSecretFile, 'utf-8').trim();
	const signer = await ThresholdSigner.fromSecret({
		apiSecret,
		serverUrl: config.serverUrl,
		apiKey: config.apiKey,
		scheme: new CGGMP24Scheme(),
	});

	try {
		console.log('   Signer address:', signer.address);
		console.log('   Paying up to 0.1 USDC...');

		const result = await fetchWithX402(X402_URL, signer, {
			maxAmount: '100000', // 0.1 USDC max (6 decimals)
		});

		console.log('   status:', result.status);
		console.log('   paid:', result.paid);
		console.log('   scheme:', result.scheme);
		console.log('   transaction:', result.transaction);
		console.log('   payer:', result.payer);
		console.log('   contentType:', result.contentType);
		console.log('   body:', result.body.slice(0, 500));
		console.log('   ✓ fetchWithX402 passed\n');
	} finally {
		signer.destroy();
	}

	console.log('=== All tests passed (including payment) ===');
}

main().catch((err) => {
	console.error('FAILED:', err);
	process.exit(1);
});
