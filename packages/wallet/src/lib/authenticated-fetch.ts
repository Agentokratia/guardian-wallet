import { getRefreshToken, getSession, getSessionServerUrl, storeSession } from './keychain.js';

// Deduplicate concurrent refresh calls (same pattern as browser api-client.ts)
let refreshing: Promise<boolean> | null = null;

/**
 * Fetch wrapper for CLI commands that require authentication.
 * Automatically retries with a refreshed access token on 401.
 */
export async function authenticatedFetch(url: string, opts?: RequestInit): Promise<Response> {
	const token = await getSession();
	if (!token) {
		throw new Error('Not logged in. Run gw login first.');
	}

	let res = await fetch(url, {
		...opts,
		headers: { ...opts?.headers, authorization: `Bearer ${token}` },
	});

	if (res.status === 401) {
		const refreshed = await refreshSession();
		if (refreshed) {
			const newToken = await getSession();
			res = await fetch(url, {
				...opts,
				headers: { ...opts?.headers, authorization: `Bearer ${newToken}` },
			});
		} else {
			throw new Error('Session expired. Run gw login again.');
		}
	}

	return res;
}

/**
 * Attempt to refresh the access token using the stored refresh token.
 * On success, persists new tokens to session.json. Returns true on success.
 * Deduplicates concurrent calls to prevent rotation race conditions.
 */
async function refreshSession(): Promise<boolean> {
	if (refreshing) return refreshing;

	refreshing = (async () => {
		const refreshToken = await getRefreshToken();
		if (!refreshToken) return false;

		const serverUrl = await getSessionServerUrl();
		if (!serverUrl) return false;

		try {
			const res = await fetch(`${serverUrl}/api/v1/auth/refresh`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ refreshToken }),
				signal: AbortSignal.timeout(10_000),
			});

			if (!res.ok) return false;

			const data = (await res.json()) as {
				token?: string;
				refreshToken?: string;
			};

			if (data.token) {
				await storeSession(data.token, serverUrl, data.refreshToken);
				return true;
			}

			return false;
		} catch {
			return false;
		}
	})();

	try {
		return await refreshing;
	} finally {
		refreshing = null;
	}
}
