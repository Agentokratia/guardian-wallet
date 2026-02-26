const API_ORIGIN = import.meta.env.VITE_API_URL ?? '';
const BASE_URL = `${API_ORIGIN.replace(/\/+$/, '')}/api/v1`;

if (!import.meta.env.VITE_API_URL && import.meta.env.PROD) {
	console.error('[api] VITE_API_URL is not set — API calls will fail in production');
}

export class ApiError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(message);
		this.name = 'ApiError';
	}
}

/** Emitted on 401/403 so the auth hook can handle it without hard redirect. */
export const authEvents = new EventTarget();
export const AUTH_EXPIRED_EVENT = 'auth:expired';

const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 500;

// ---------------------------------------------------------------------------
// Silent refresh — try once before dispatching AUTH_EXPIRED_EVENT
// ---------------------------------------------------------------------------

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
	// Deduplicate concurrent refresh calls
	if (refreshing) return refreshing;
	refreshing = (async () => {
		try {
			const res = await fetch(`${BASE_URL}/auth/refresh`, {
				method: 'POST',
				credentials: 'include',
			});
			return res.ok;
		} catch {
			return false;
		} finally {
			refreshing = null;
		}
	})();
	return refreshing;
}

// ---------------------------------------------------------------------------
// Core request function
// ---------------------------------------------------------------------------

async function request<T>(
	method: string,
	path: string,
	body?: unknown,
	timeoutMs = 30_000,
): Promise<T> {
	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), timeoutMs);

			const res = await fetch(`${BASE_URL}${path}`, {
				method,
				headers: body ? { 'Content-Type': 'application/json' } : undefined,
				body: body ? JSON.stringify(body) : undefined,
				credentials: 'include',
				signal: controller.signal,
			});
			clearTimeout(timeout);

			if (!res.ok) {
				if (res.status === 401) {
					// Try silent refresh before giving up
					const refreshed = await tryRefresh();
					if (refreshed) {
						// Retry the original request with new cookie
						const retryRes = await fetch(`${BASE_URL}${path}`, {
							method,
							headers: body ? { 'Content-Type': 'application/json' } : undefined,
							body: body ? JSON.stringify(body) : undefined,
							credentials: 'include',
							signal: AbortSignal.timeout(timeoutMs),
						});
						if (retryRes.ok) {
							if (retryRes.status === 204) return undefined as T;
							return retryRes.json() as Promise<T>;
						}
						// Retry failed — throw from retry response, not original
						const retryText = await retryRes.text().catch(() => retryRes.statusText);
						let retryMessage = retryText;
						try {
							const json = JSON.parse(retryText) as { message?: string };
							if (json.message) retryMessage = json.message;
						} catch {
							// Not JSON
						}
						authEvents.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
						throw new ApiError(retryRes.status, retryMessage);
					}
					// Refresh itself failed — session is truly expired
					authEvents.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
				}
				const text = await res.text().catch(() => res.statusText);
				// Extract human-readable message from JSON error responses
				let message = text;
				try {
					const json = JSON.parse(text) as { message?: string };
					if (json.message) message = json.message;
				} catch {
					// Not JSON — use raw text
				}
				throw new ApiError(res.status, message);
			}

			if (res.status === 204) return undefined as T;
			return res.json() as Promise<T>;
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));

			// Don't retry auth errors, client errors, or 503 (deliberate "not ready")
			if (err instanceof ApiError && (err.status < 500 || err.status === 503)) throw err;

			// Retry on network errors or 5xx
			if (attempt < MAX_RETRIES) {
				await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
				continue;
			}
			throw lastError;
		}
	}

	throw lastError ?? new Error('Request failed');
}

/** Fetch a path outside /api/v1 (e.g. /health). */
async function rawGet<T>(path: string): Promise<T> {
	const origin = API_ORIGIN.replace(/\/+$/, '');
	const res = await fetch(`${origin}${path}`, { credentials: 'include' });
	if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
	return res.json() as Promise<T>;
}

export const api = {
	get: <T>(path: string) => request<T>('GET', path),
	post: <T>(path: string, body?: unknown, timeoutMs?: number) =>
		request<T>('POST', path, body, timeoutMs),
	put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
	patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
	del: <T>(path: string) => request<T>('DELETE', path),
	rawGet,
};
