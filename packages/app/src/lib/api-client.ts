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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 30_000);

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
					// Only 401 (Unauthorized) means the session expired.
					// 403 (Forbidden) means authenticated but not authorized for this action
					// (e.g. policy block, ownership check) — do NOT clear auth state.
					authEvents.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
					const text = await res.text().catch(() => res.statusText);
					throw new ApiError(res.status, text);
				}
				const text = await res.text().catch(() => res.statusText);
				throw new ApiError(res.status, text);
			}

			if (res.status === 204) return undefined as T;
			return res.json() as Promise<T>;
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));

			// Don't retry auth errors or client errors
			if (err instanceof ApiError && err.status < 500) throw err;

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

export const api = {
	get: <T>(path: string) => request<T>('GET', path),
	post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
	put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
	patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
	del: <T>(path: string) => request<T>('DELETE', path),
};
