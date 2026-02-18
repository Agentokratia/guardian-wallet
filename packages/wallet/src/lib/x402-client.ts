import type { ThresholdSigner } from '@agentokratia/guardian-signer';

/** Result from checking a URL for x402 payment requirements. */
export interface X402CheckResult {
	requires402: boolean;
	url: string;
	paymentDetails?: {
		scheme: string;
		network: string;
		maxAmountRequired: string;
		resource: string;
		description?: string;
		mimeType?: string;
		payTo?: string;
		extra?: Record<string, unknown>;
	};
}

/** Result from fetching a 402-protected resource with auto-payment. */
export interface X402FetchResult {
	status: number;
	url: string;
	paid: boolean;
	paymentHash?: string;
	contentType?: string;
	body: string;
}

/** Result from discovering 402-protected endpoints on a domain. */
export interface X402DiscoverResult {
	domain: string;
	endpoints: Array<{
		path: string;
		method: string;
		scheme: string;
		maxAmount: string;
		description?: string;
	}>;
}

/**
 * Check if a URL requires x402 payment.
 * Sends a GET and looks for 402 status + payment headers.
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

	const paymentHeader = response.headers.get('X-Payment') || response.headers.get('x-payment');
	const contentType = response.headers.get('content-type') || '';

	let paymentDetails: X402CheckResult['paymentDetails'] | undefined;

	if (paymentHeader) {
		try {
			const parsed = JSON.parse(paymentHeader) as Record<string, unknown>;
			paymentDetails = {
				scheme: String(parsed.scheme || 'exact'),
				network: String(parsed.network || 'unknown'),
				maxAmountRequired: String(parsed.maxAmountRequired || parsed.amount || '0'),
				resource: url,
				description: parsed.description ? String(parsed.description) : undefined,
				payTo: parsed.payTo ? String(parsed.payTo) : undefined,
				extra: parsed,
			};
		} catch {
			// Non-JSON payment header
		}
	}

	// Try body if no header
	if (!paymentDetails && contentType.includes('json')) {
		try {
			const body = (await response.json()) as Record<string, unknown>;
			if (body.accepts || body.payment || body.x402) {
				const payment = (body.accepts || body.payment || body.x402) as Record<string, unknown>;
				paymentDetails = {
					scheme: String(payment.scheme || 'exact'),
					network: String(payment.network || 'unknown'),
					maxAmountRequired: String(payment.maxAmountRequired || payment.amount || '0'),
					resource: url,
					description: payment.description ? String(payment.description) : undefined,
					payTo: payment.payTo ? String(payment.payTo) : undefined,
					extra: payment,
				};
			}
		} catch {
			// Not JSON body
		}
	}

	return {
		requires402: true,
		url,
		paymentDetails: paymentDetails || {
			scheme: 'unknown',
			network: 'unknown',
			maxAmountRequired: '0',
			resource: url,
		},
	};
}

/**
 * Discover x402-protected endpoints on a domain.
 * Probes common paths and checks for 402 responses.
 */
export async function discoverX402(domain: string): Promise<X402DiscoverResult> {
	const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;
	const probePaths = ['/', '/api', '/api/v1', '/data', '/premium', '/content', '/.well-known/x402'];

	const endpoints: X402DiscoverResult['endpoints'] = [];

	// Check well-known endpoint first
	try {
		const wellKnown = await fetch(`${baseUrl}/.well-known/x402`, {
			signal: AbortSignal.timeout(10_000),
		});
		if (wellKnown.ok) {
			const body = (await wellKnown.json()) as {
				endpoints?: Array<Record<string, unknown>>;
			};
			if (body.endpoints) {
				for (const ep of body.endpoints) {
					endpoints.push({
						path: String(ep.path || '/'),
						method: String(ep.method || 'GET'),
						scheme: String(ep.scheme || 'exact'),
						maxAmount: String(ep.maxAmount || ep.maxAmountRequired || '0'),
						description: ep.description ? String(ep.description) : undefined,
					});
				}
				return { domain, endpoints };
			}
		}
	} catch {
		// No well-known endpoint
	}

	// Probe common paths
	const probes = probePaths.map(async (path) => {
		try {
			const result = await checkX402(`${baseUrl}${path}`);
			if (result.requires402 && result.paymentDetails) {
				endpoints.push({
					path,
					method: 'GET',
					scheme: result.paymentDetails.scheme,
					maxAmount: result.paymentDetails.maxAmountRequired,
					description: result.paymentDetails.description,
				});
			}
		} catch {
			// Skip unreachable paths
		}
	});

	await Promise.allSettled(probes);

	return { domain, endpoints };
}

/**
 * Fetch a 402-protected resource, automatically paying with the signer if needed.
 *
 * Flow:
 *   1. GET the URL
 *   2. If 402 → parse payment requirements
 *   3. Sign the payment (EIP-191 message)
 *   4. Retry with payment proof header
 */
export async function fetchWithX402(
	url: string,
	signer: ThresholdSigner,
	opts?: { maxAmount?: string; network?: string },
): Promise<X402FetchResult> {
	// First request — check if payment is needed
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

	// Parse payment requirements
	const check = await checkX402(url);
	if (!check.paymentDetails) {
		throw new Error('402 response but could not parse payment requirements');
	}

	const payment = check.paymentDetails;
	const maxAllowed = opts?.maxAmount || '1000000'; // 1 USDC default max

	if (BigInt(payment.maxAmountRequired) > BigInt(maxAllowed)) {
		throw new Error(
			`Payment amount ${payment.maxAmountRequired} exceeds max allowed ${maxAllowed}`,
		);
	}

	// Sign payment authorization
	const nonce = Date.now().toString();
	const targetNetwork = payment.network || opts?.network || 'base-sepolia';

	const paymentMessage = JSON.stringify({
		scheme: payment.scheme,
		network: targetNetwork,
		resource: url,
		amount: payment.maxAmountRequired,
		payTo: payment.payTo || '',
		nonce,
	});

	const signature = await signer.signMessage(paymentMessage);

	// Retry with payment proof (nonce must match the signed message)
	const paymentProof = JSON.stringify({
		x402Version: 1,
		scheme: payment.scheme,
		network: targetNetwork,
		payload: {
			resource: url,
			amount: payment.maxAmountRequired,
			payTo: payment.payTo || '',
			nonce,
			signature: signature.signature,
			from: signer.address,
		},
	});

	const paidResponse = await fetch(url, {
		method: 'GET',
		headers: {
			'X-PAYMENT': paymentProof,
		},
		signal: AbortSignal.timeout(15_000),
		redirect: 'follow',
	});

	return {
		status: paidResponse.status,
		url,
		paid: true,
		paymentHash: `${signature.signature.slice(0, 20)}...`,
		contentType: paidResponse.headers.get('content-type') || undefined,
		body: await paidResponse.text(),
	};
}
