// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface HttpClientConfig {
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly timeout?: number;
}

// ---------------------------------------------------------------------------
// Interactive signing session types (DKLs23 multi-round protocol)
// ---------------------------------------------------------------------------

export interface CreateSignSessionRequest {
	readonly signerFirstMessage: string; // base64
	readonly transaction: Record<string, unknown>;
}

export interface CreateSignSessionResponse {
	readonly sessionId: string;
	readonly serverFirstMessage: string; // base64
	readonly initialMessages?: string[]; // base64 — server's round 1 outgoing
	readonly roundsRemaining: number;
}

export interface CreateMessageSignSessionRequest {
	readonly signerFirstMessage: string; // base64
	readonly message: unknown;
}

export interface CreateMessageSignSessionResponse {
	readonly sessionId: string;
	readonly serverFirstMessage: string; // base64
	readonly initialMessages?: string[]; // base64 — server's round 1 outgoing
	readonly roundsRemaining: number;
}

export interface ProcessSignRoundRequest {
	readonly sessionId: string;
	readonly messages: string[]; // base64
}

export interface ProcessSignRoundResponse {
	readonly messages: string[]; // base64
	readonly roundsRemaining: number;
	readonly presigned: boolean;
	readonly messageHash?: string; // base64 — server-computed hash, returned when presigned
}

export interface CompleteSignRequest {
	readonly sessionId: string;
	readonly lastMessage: string; // base64
	readonly messageHash: string; // base64
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
			body: JSON.stringify(body),
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
				throw new HttpClientError(408, `Request timed out after ${this.timeout}ms: ${init.method} ${path}`);
			}
			throw err;
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
	// Interactive signing session (DKLs23 multi-round protocol)
	// -----------------------------------------------------------------------

	/**
	 * Start an interactive signing session for a transaction.
	 * Sends the signer's first DKLs23 message + transaction data.
	 */
	async createSignSession(data: CreateSignSessionRequest): Promise<CreateSignSessionResponse> {
		return this.post<CreateSignSessionResponse>(`${API_PREFIX}/sign/session`, data);
	}

	/**
	 * Start an interactive signing session for a message (raw or EIP-712).
	 * Sends the signer's first DKLs23 message + message data.
	 */
	async createMessageSignSession(
		data: CreateMessageSignSessionRequest,
	): Promise<CreateMessageSignSessionResponse> {
		return this.post<CreateMessageSignSessionResponse>(
			`${API_PREFIX}/sign-message/session`,
			data,
		);
	}

	/**
	 * Exchange a round of DKLs23 messages with the server.
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
		return this.post<CompleteMessageSignResponse>(
			`${API_PREFIX}/sign-message/complete`,
			data,
		);
	}

}
