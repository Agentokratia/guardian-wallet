import { AUTH_EXPIRED_EVENT, api, authEvents } from '@/lib/api-client';
import {
	authenticateWithPRF,
	deriveEOAFromPRF,
	isPRFSupported,
	registerPasskeyWithPRF,
	wipeKey,
	wipePRF,
} from '@agentokratia/guardian-auth/browser';
import type { WebAuthnAuthResult } from '@agentokratia/guardian-auth/shared';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

interface AuthState {
	isAuthenticated: boolean;
	loading: boolean;
	address: string | undefined;
	email: string | undefined;
	userId: string | undefined;
	hasPasskey: boolean;
	prfSupported: boolean;
}

interface AuthContextValue extends AuthState {
	/** Send OTP to email (login or register). Skips OTP if user has passkey (unless sendOtp: true). */
	login: (email: string, options?: { sendOtp?: boolean }) => Promise<{ hasPasskey: boolean }>;
	/** Step 2: Verify OTP → session created */
	verifyOTP: (email: string, code: string) => Promise<{ userId: string }>;
	/** Passkey login for returning users (Touch ID) */
	passkeyLogin: (email: string) => Promise<void>;
	/** Optional: Set up passkey for dashboard signing. Returns PRF output if available. */
	setupPasskey: () => Promise<Uint8Array | null>;
	/** Logout */
	logout: () => Promise<void>;
	/** Refresh session */
	checkSession: () => Promise<void>;
	/** Authenticate with passkey to get PRF output for share encryption/decryption */
	refreshPRF: () => Promise<Uint8Array>;
}

export const AuthContext = createContext<AuthContextValue>({
	isAuthenticated: false,
	loading: true,
	address: undefined,
	email: undefined,
	userId: undefined,
	hasPasskey: false,
	prfSupported: false,
	login: async () => ({ hasPasskey: false }),
	verifyOTP: async () => ({ userId: '' }),
	passkeyLogin: async () => {},
	setupPasskey: async () => null,
	logout: async () => {},
	checkSession: async () => {},
	refreshPRF: async () => {
		throw new Error('AuthContext not initialized');
	},
});

export function useAuthState(): AuthContextValue {
	const [state, setState] = useState<AuthState>({
		isAuthenticated: false,
		loading: true,
		address: undefined,
		email: undefined,
		userId: undefined,
		hasPasskey: false,
		prfSupported: false,
	});

	// Store passkey setup options
	const setupOptionsRef = useRef<unknown>(null);

	// Check PRF support on mount
	useEffect(() => {
		isPRFSupported().then((supported) => {
			setState((prev) => ({ ...prev, prfSupported: supported }));
		});
	}, []);

	const checkSession = useCallback(async () => {
		try {
			const result = await api.get<{
				address?: string;
				email?: string;
				userId?: string;
				hasPasskey?: boolean;
			}>('/auth/me');
			setState((prev) => ({
				...prev,
				isAuthenticated: true,
				loading: false,
				address: result.address,
				email: result.email,
				userId: result.userId,
				hasPasskey: result.hasPasskey ?? false,
			}));
		} catch {
			setState((prev) => ({
				...prev,
				isAuthenticated: false,
				loading: false,
				address: undefined,
				email: undefined,
				userId: undefined,
				hasPasskey: false,
			}));
		}
	}, []);

	useEffect(() => {
		checkSession();
	}, [checkSession]);

	// Listen for 401/403 from API client → clear local auth state
	useEffect(() => {
		const handler = () => {
			setState((prev) => ({
				...prev,
				isAuthenticated: false,
				loading: false,
				address: undefined,
				email: undefined,
				userId: undefined,
				hasPasskey: false,
			}));
		};
		authEvents.addEventListener(AUTH_EXPIRED_EVENT, handler);
		return () => authEvents.removeEventListener(AUTH_EXPIRED_EVENT, handler);
	}, []);

	/** Login — checks user, sends OTP only when needed.
	 *  Passkey users: no OTP sent (unless sendOtp: true for "Use email code" fallback). */
	const login = useCallback(
		async (email: string, options?: { sendOtp?: boolean }): Promise<{ hasPasskey: boolean }> => {
			const result = await api.post<{ hasPasskey?: boolean }>('/auth/login', {
				email,
				sendOtp: options?.sendOtp,
			});
			return { hasPasskey: result.hasPasskey ?? false };
		},
		[],
	);

	/** Step 2: Verify OTP → session created (POST /auth/verify-otp) */
	const verifyOTP = useCallback(async (email: string, code: string) => {
		const result = await api.post<{
			userId: string;
			email: string;
			address?: string;
		}>('/auth/verify-otp', { email, code });

		setState((prev) => ({
			...prev,
			isAuthenticated: true,
			loading: false,
			address: result.address,
			email: result.email,
			userId: result.userId,
			hasPasskey: false,
		}));

		return { userId: result.userId };
	}, []);

	/** Passkey login for returning users — Touch ID, no OTP needed. */
	const passkeyLogin = useCallback(async (email: string): Promise<void> => {
		// Step 1: Get challenge with credential IDs
		const { authOptions } = await api.post<{
			authOptions: { rpId: string; challenge: string; allowCredentials?: { id: string }[] };
		}>('/auth/passkey/login-challenge', { email });

		// Step 2: Trigger Touch ID / passkey ceremony
		const authResult = await authenticateWithPRF({
			rpId: authOptions.rpId,
			challenge: authOptions.challenge,
			allowCredentialIds: authOptions.allowCredentials?.map((c) => c.id) ?? [],
		});

		// Step 3: Verify on server → get JWT (cookie set automatically)
		const result = await api.post<{
			userId: string;
			email: string;
			address?: string;
		}>('/auth/passkey/login-verify', {
			email,
			response: authResult.authenticationResponseJSON,
		});

		// Step 4: Update auth state
		setState((prev) => ({
			...prev,
			isAuthenticated: true,
			loading: false,
			address: result.address,
			email: result.email,
			userId: result.userId,
			hasPasskey: true,
		}));

		// Wipe PRF output if present (not needed for login)
		if (authResult.prfOutput) {
			wipePRF(authResult.prfOutput);
		}
	}, []);

	/** Optional: Set up passkey for dashboard signing (PRF-based share encryption).
	 *  Returns the PRF output from registration so callers can use it immediately
	 *  without triggering a second passkey ceremony. Caller must wipe when done. */
	const setupPasskey = useCallback(async (): Promise<Uint8Array | null> => {
		// Step 1: Get setup challenge
		const { registrationOptions } = await api.post<{ registrationOptions: unknown }>(
			'/auth/passkey/setup-challenge',
		);
		setupOptionsRef.current = registrationOptions;

		// Step 2: Register passkey with PRF
		const regResult = await registerPasskeyWithPRF(
			registrationOptions as Parameters<typeof registerPasskeyWithPRF>[0],
		);
		setupOptionsRef.current = null;

		// Derive wallet from PRF if available
		let prfDerivedAddress: string | undefined;
		let prfOutput: Uint8Array | null = null;
		if (regResult.prfOutput) {
			const wallet = deriveEOAFromPRF(regResult.prfOutput);
			prfDerivedAddress = wallet.address;
			wipeKey(wallet);
			// Return PRF output to caller instead of wiping — caller is responsible for cleanup
			prfOutput = regResult.prfOutput;
		}

		// Step 3: Complete setup on server
		await api.post('/auth/passkey/setup-complete', {
			response: regResult.registrationResponseJSON,
			prfDerivedAddress,
		});

		setState((prev) => ({ ...prev, hasPasskey: true }));
		return prfOutput;
	}, []);

	/**
	 * Always-fresh PRF: triggers a passkey ceremony to get PRF output.
	 * The output is returned directly — NOT stored in memory.
	 * Caller is responsible for wiping it after use.
	 *
	 * IMPORTANT: Callers must check `hasPasskey` and call `setupPasskey()` first
	 * if no passkey is registered. This avoids stale-closure issues when chaining
	 * setupPasskey → refreshPRF in the same async flow.
	 */
	const refreshPRF = useCallback(async (): Promise<Uint8Array> => {
		const email = state.email;
		if (!email) throw new Error('Not authenticated — no email on file.');

		// Get auth challenge with credential IDs so the browser auto-selects the passkey
		const { authOptions } = await api.post<{
			authOptions: { rpId: string; challenge: string; allowCredentials?: { id: string }[] };
		}>('/auth/passkey/auth-challenge');

		// Trigger passkey dialog — credential IDs enable auto-select (no picker)
		const authResult: WebAuthnAuthResult = await authenticateWithPRF({
			rpId: authOptions.rpId,
			challenge: authOptions.challenge,
			allowCredentialIds: authOptions.allowCredentials?.map((c) => c.id) ?? [],
		});

		if (!authResult.prfOutput) {
			throw new Error('Passkey does not support PRF extension. Please re-register.');
		}

		return authResult.prfOutput;
	}, [state.email]);

	const logout = useCallback(async () => {
		try {
			await api.post('/auth/logout');
		} catch (err) {
			console.warn('Logout API call failed — clearing local session anyway:', err);
		}
		setState((prev) => ({
			...prev,
			isAuthenticated: false,
			loading: false,
			address: undefined,
			email: undefined,
			userId: undefined,
			hasPasskey: false,
		}));
	}, []);

	return {
		...state,
		login,
		verifyOTP,
		passkeyLogin,
		setupPasskey,
		logout,
		checkSession,
		refreshPRF,
	};
}

export function useAuth(): AuthContextValue {
	return useContext(AuthContext);
}
