/**
 * x402 Protocol Client for Guardian Wallet
 *
 * Supports the x402 **exact** payment scheme (ERC-3009 / Permit2) via @x402/evm.
 * Both v2 (CAIP-2 networks, PAYMENT-REQUIRED/PAYMENT-SIGNATURE headers) and
 * v1 (legacy network names, X-PAYMENT header) are supported.
 */

import type { ThresholdSigner } from '@agentokratia/guardian-signer';
import type { PaymentRequired, PaymentRequirements } from '@x402/core/types';
import type { ClientEvmSigner } from '@x402/evm';

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export interface X402CheckResult {
	requires402: boolean;
	url: string;
	paymentRequired?: PaymentRequired;
}

export interface X402FetchResult {
	status: number;
	url: string;
	paid: boolean;
	scheme?: string;
	transaction?: string;
	payer?: string;
	contentType?: string;
	body: string;
}

export interface X402DiscoverResult {
	domain: string;
	endpoints: Array<{
		path: string;
		method: string;
		scheme?: string;
		network?: string;
		amount?: string;
		asset?: string;
		description?: string;
	}>;
}

export interface X402FetchOptions {
	/** Maximum amount willing to pay in atomic units (e.g., "1000000" = 1 USDC). */
	maxAmount?: string;
	/** Preferred token addresses in order. Reorders the accepts list. */
	preferTokens?: string[];
}

// ---------------------------------------------------------------------------
// Signer Bridge
// ---------------------------------------------------------------------------

/**
 * Bridge ThresholdSigner → ClientEvmSigner for @x402/evm.
 * ThresholdSigner.signMessage() detects EIP-712 typed data via `{ domain }`.
 */
function toX402Signer(signer: ThresholdSigner): ClientEvmSigner {
	return {
		address: signer.address as `0x${string}`,
		async signTypedData(message: {
			domain: Record<string, unknown>;
			types: Record<string, unknown>;
			primaryType: string;
			message: Record<string, unknown>;
		}): Promise<`0x${string}`> {
			const result = await signer.signMessage(message);
			return result.signature as `0x${string}`;
		},
	};
}

// ---------------------------------------------------------------------------
// Header Parsing (for checkX402 / discoverX402 — no signer needed)
// ---------------------------------------------------------------------------

const PAYMENT_REQUIRED_HEADERS = ['payment-required', 'x-payment'] as const;
const PAYMENT_RESPONSE_HEADERS = ['payment-response', 'x-payment-response'] as const;

function decodeBase64Header<T>(raw: string): T {
	return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
}

function readHeader(headers: Headers, names: readonly string[]): string | null {
	for (const name of names) {
		const val = headers.get(name);
		if (val) return val;
	}
	return null;
}

async function parsePaymentRequired(response: Response): Promise<PaymentRequired | null> {
	const raw = readHeader(response.headers, PAYMENT_REQUIRED_HEADERS);
	if (raw) {
		try {
			return decodeBase64Header<PaymentRequired>(raw);
		} catch {
			// Malformed header — try body
		}
	}

	const ct = response.headers.get('content-type') || '';
	if (ct.includes('json')) {
		try {
			const body = (await response.json()) as Record<string, unknown>;
			if (Array.isArray(body.accepts)) return body as unknown as PaymentRequired;
		} catch {
			// Not JSON
		}
	}

	return null;
}

interface SettlementData {
	transaction?: string;
	payer?: string;
}

function parseSettlement(headers: Headers): SettlementData | null {
	const raw = readHeader(headers, PAYMENT_RESPONSE_HEADERS);
	if (!raw) return null;
	try {
		return decodeBase64Header<SettlementData>(raw);
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

function maxAmountPolicy(max: string) {
	const limit = BigInt(max);
	return (_v: number, reqs: PaymentRequirements[]): PaymentRequirements[] =>
		reqs.filter((r) => BigInt(r.amount) <= limit);
}

function preferTokensPolicy(tokens: string[]) {
	const normalized = tokens.map((t) => t.toLowerCase());
	return (_v: number, reqs: PaymentRequirements[]): PaymentRequirements[] => {
		const preferred: (PaymentRequirements | undefined)[] = new Array(normalized.length);
		const rest: PaymentRequirements[] = [];
		for (const r of reqs) {
			const idx = normalized.indexOf(r.asset.toLowerCase());
			if (idx >= 0) preferred[idx] = r;
			else rest.push(r);
		}
		return [...(preferred.filter(Boolean) as PaymentRequirements[]), ...rest];
	};
}

// ---------------------------------------------------------------------------
// x402 Client Factory
// ---------------------------------------------------------------------------

async function createHttpClient(signer: ThresholdSigner, opts?: X402FetchOptions) {
	const { x402Client, x402HTTPClient } = await import('@x402/core/client');
	const { registerExactEvmScheme } = await import('@x402/evm/exact/client');

	const client = new x402Client();
	registerExactEvmScheme(client, { signer: toX402Signer(signer) });

	if (opts?.maxAmount) client.registerPolicy(maxAmountPolicy(opts.maxAmount));
	if (opts?.preferTokens?.length) client.registerPolicy(preferTokensPolicy(opts.preferTokens));

	return new x402HTTPClient(client);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if a URL requires x402 payment. No signer needed.
 */
export async function checkX402(url: string): Promise<X402CheckResult> {
	const response = await fetch(url, {
		method: 'GET',
		signal: AbortSignal.timeout(15_000),
		redirect: 'follow',
	});

	if (response.status !== 402) {
		return { requires402: false, url };
	}

	const paymentRequired = await parsePaymentRequired(response);
	return { requires402: true, url, paymentRequired: paymentRequired ?? undefined };
}

/**
 * Discover x402-protected endpoints on a domain.
 * Checks .well-known/x402 first, then probes common paths.
 */
export async function discoverX402(domain: string): Promise<X402DiscoverResult> {
	const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;
	const endpoints: X402DiscoverResult['endpoints'] = [];

	// 1. Try .well-known/x402 (returns endpoint manifest)
	try {
		const wellKnown = await fetch(`${baseUrl}/.well-known/x402`, {
			signal: AbortSignal.timeout(10_000),
		});
		if (wellKnown.ok) {
			const body = (await wellKnown.json()) as { endpoints?: Array<Record<string, unknown>> };
			if (body.endpoints) {
				for (const ep of body.endpoints) {
					endpoints.push({
						path: String(ep.path || '/'),
						method: String(ep.method || 'GET'),
						scheme: ep.scheme ? String(ep.scheme) : undefined,
						network: ep.network ? String(ep.network) : undefined,
						amount: ep.amount ? String(ep.amount) : undefined,
						asset: ep.asset ? String(ep.asset) : undefined,
						description: ep.description ? String(ep.description) : undefined,
					});
				}
				return { domain, endpoints };
			}
		}
	} catch {
		// No well-known endpoint
	}

	// 2. Probe common paths (well-known not included — already checked above)
	const probePaths = ['/', '/api', '/api/v1', '/data', '/premium', '/content'];

	const probes = probePaths.map(async (path) => {
		try {
			const result = await checkX402(`${baseUrl}${path}`);
			if (result.requires402 && result.paymentRequired) {
				for (const req of result.paymentRequired.accepts) {
					endpoints.push({
						path,
						method: 'GET',
						scheme: req.scheme,
						network: req.network,
						amount: req.amount,
						asset: req.asset,
					});
				}
			}
		} catch {
			// Unreachable
		}
	});

	await Promise.allSettled(probes);
	return { domain, endpoints };
}

/**
 * Fetch a 402-protected resource, automatically paying via the x402 exact scheme.
 *
 * 1. GET → if not 402, return response
 * 2. Parse PAYMENT-REQUIRED header → PaymentRequirements[]
 * 3. Apply policies (maxAmount, preferTokens)
 * 4. Sign EIP-712 payment payload via threshold signer
 * 5. Retry with PAYMENT-SIGNATURE header
 * 6. Parse settlement from PAYMENT-RESPONSE header
 */
export async function fetchWithX402(
	url: string,
	signer: ThresholdSigner,
	opts?: X402FetchOptions,
): Promise<X402FetchResult> {
	const initial = await fetch(url, {
		method: 'GET',
		signal: AbortSignal.timeout(15_000),
		redirect: 'follow',
	});

	if (initial.status !== 402) {
		return {
			status: initial.status,
			url,
			paid: false,
			contentType: initial.headers.get('content-type') || undefined,
			body: await initial.text(),
		};
	}

	const paymentRequired = await parsePaymentRequired(initial);
	if (!paymentRequired?.accepts?.length) {
		throw new Error('402 response but could not parse payment requirements');
	}

	const httpClient = await createHttpClient(signer, opts);
	const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
	const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

	const paidResponse = await fetch(url, {
		method: 'GET',
		headers: paymentHeaders,
		signal: AbortSignal.timeout(30_000),
		redirect: 'follow',
	});

	const settlement = parseSettlement(paidResponse.headers);

	return {
		status: paidResponse.status,
		url,
		paid: true,
		scheme: 'exact',
		transaction: settlement?.transaction,
		payer: settlement?.payer,
		contentType: paidResponse.headers.get('content-type') || undefined,
		body: await paidResponse.text(),
	};
}
