// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface HttpClientConfig {
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly timeout?: number;
}

// ---------------------------------------------------------------------------
// Interactive signing session types (CGGMP24 multi-round protocol)
// ---------------------------------------------------------------------------

export interface CreateSignSessionRequest {
	readonly signerFirstMessage?: string; // base64 — optional for tx signing (server computes hash)
	readonly transaction: Record<string, unknown>;
}

export interface CreateSignSessionResponse {
	readonly sessionId: string;
	readonly serverFirstMessages: string[]; // base64 — server's first protocol messages
	readonly messageHash: string; // base64 — 32-byte hash computed by server
	readonly eid: string; // base64 — execution ID
	readonly partyConfig: {
		readonly serverPartyIndex: number;
		readonly clientPartyIndex: number;
		readonly partiesAtKeygen: number[];
	};
	readonly roundsRemaining: number;
}

export interface CreateMessageSignSessionRequest {
	readonly signerFirstMessage?: string; // base64 — optional (server generates EID first)
	readonly messageHash: string; // base64 — CGGMP24 requires hash upfront
	readonly message: unknown;
}

export interface CreateMessageSignSessionResponse {
	readonly sessionId: string;
	readonly serverFirstMessages: string[]; // base64 — server's first protocol messages
	readonly messageHash: string; // base64
	readonly eid: string; // base64
	readonly partyConfig: {
		readonly serverPartyIndex: number;
		readonly clientPartyIndex: number;
		readonly partiesAtKeygen: number[];
	};
	readonly roundsRemaining: number;
}

export interface ProcessSignRoundRequest {
	readonly sessionId: string;
	readonly messages: string[]; // base64
}

export interface ProcessSignRoundResponse {
	readonly messages: string[]; // base64
	readonly roundsRemaining: number;
	readonly complete: boolean;
}

export interface CompleteSignRequest {
	readonly sessionId: string;
}

export interface CompleteSignResponse {
	readonly txHash: string;
	readonly signature: { r: string; s: string; v: number };
}

export interface CompleteMessageSignResponse {
	readonly signature: { r: string; s: string; v: number };
}

export interface HttpErrorBody {
	readonly message: string;
	readonly statusCode: number;
	readonly violations?: unknown[];
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class HttpClientError extends Error {
	constructor(
		public readonly statusCode: number,
		public readonly body: string,
	) {
		super(`HTTP ${statusCode}: ${body}`);
		this.name = 'HttpClientError';
	}
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const API_PREFIX = '/api/v1';

export class HttpClient {
	private readonly baseUrl: string;
	private readonly apiKey: string;
	private readonly timeout: number;

	constructor(config: HttpClientConfig) {
		this.baseUrl = config.baseUrl.replace(/\/+$/, '');
		this.apiKey = config.apiKey;
		this.timeout = config.timeout ?? 30_000;
	}

	// -----------------------------------------------------------------------
	// Generic HTTP helpers
	// -----------------------------------------------------------------------

	async post<T>(path: string, body: unknown): Promise<T> {
		return this.request<T>(path, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': this.apiKey,
			},
			body: JSON.stringify(body, (_key, value) =>
				typeof value === 'bigint' ? value.toString() : value,
			),
		});
	}

	async get<T>(path: string): Promise<T> {
		return this.request<T>(path, {
			method: 'GET',
			headers: {
				'x-api-key': this.apiKey,
			},
		});
	}

	private async request<T>(path: string, init: RequestInit): Promise<T> {
		let response: Response;
		try {
			response = await fetch(`${this.baseUrl}${path}`, {
				...init,
				signal: AbortSignal.timeout(this.timeout),
			});
		} catch (err: unknown) {
			if (err instanceof Error && err.name === 'AbortError') {
				throw new HttpClientError(
					408,
					`Request timed out after ${this.timeout}ms: ${init.method} ${path}`,
				);
			}
			// Retry once on ECONNRESET — Node.js fetch (undici) can hit a stale
			// keep-alive connection that the server already closed.
			if (this.isConnectionReset(err)) {
				await new Promise((r) => setTimeout(r, 100));
				try {
					response = await fetch(`${this.baseUrl}${path}`, {
						...init,
						signal: AbortSignal.timeout(this.timeout),
					});
				} catch (retryErr: unknown) {
					if (retryErr instanceof Error && retryErr.name === 'AbortError') {
						throw new HttpClientError(
							408,
							`Request timed out after ${this.timeout}ms: ${init.method} ${path}`,
						);
					}
					throw retryErr;
				}
			} else {
				throw err;
			}
		}

		if (!response.ok) {
			const text = await response.text();
			throw new HttpClientError(response.status, text);
		}

		const text = await response.text();
		try {
			return JSON.parse(text) as T;
		} catch {
			throw new HttpClientError(response.status, `Invalid JSON response: ${text.slice(0, 200)}`);
		}
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	private isConnectionReset(err: unknown): boolean {
		if (!(err instanceof Error)) return false;
		const msg = err.message + (err.cause instanceof Error ? ` ${err.cause.message}` : '');
		return (
			msg.includes('ECONNRESET') ||
			msg.includes('socket hang up') ||
			msg.includes('network socket disconnected')
		);
	}

	// -----------------------------------------------------------------------
	// Interactive signing session (CGGMP24 multi-round protocol)
	// -----------------------------------------------------------------------

	/**
	 * Start an interactive signing session for a transaction.
	 * Sends the signer's first CGGMP24 message + transaction data.
	 */
	async createSignSession(data: CreateSignSessionRequest): Promise<CreateSignSessionResponse> {
		return this.post<CreateSignSessionResponse>(`${API_PREFIX}/sign/session`, data);
	}

	/**
	 * Start an interactive signing session for a message (raw or EIP-712).
	 * Sends the signer's first CGGMP24 message + message hash + message data.
	 */
	async createMessageSignSession(
		data: CreateMessageSignSessionRequest,
	): Promise<CreateMessageSignSessionResponse> {
		return this.post<CreateMessageSignSessionResponse>(`${API_PREFIX}/sign-message/session`, data);
	}

	/**
	 * Exchange a round of CGGMP24 messages with the server.
	 */
	async processSignRound(data: ProcessSignRoundRequest): Promise<ProcessSignRoundResponse> {
		return this.post<ProcessSignRoundResponse>(`${API_PREFIX}/sign/round`, data);
	}

	/**
	 * Finalize the signing session. For transactions this broadcasts and
	 * returns the txHash. For messages it returns the (v,r,s) signature.
	 */
	async completeSign(data: CompleteSignRequest): Promise<CompleteSignResponse> {
		return this.post<CompleteSignResponse>(`${API_PREFIX}/sign/complete`, data);
	}

	/**
	 * Finalize a message signing session. Returns the (v,r,s) signature.
	 */
	async completeMessageSign(data: CompleteSignRequest): Promise<CompleteMessageSignResponse> {
		return this.post<CompleteMessageSignResponse>(`${API_PREFIX}/sign-message/complete`, data);
	}
}
