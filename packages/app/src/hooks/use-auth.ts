import { AUTH_EXPIRED_EVENT, api, authEvents } from '@/lib/api-client';
import {
	authenticateWithPRF,
	deriveEOAFromPRF,
	isPRFSupported,
	registerPasskeyWithPRF,
	wipeKey,
	wipePRF,
} from '@agentokratia/guardian-auth/browser';
import type { WebAuthnAuthResult, WebAuthnRegistrationResult } from '@agentokratia/guardian-auth/shared';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

interface AuthState {
	isAuthenticated: boolean;
	loading: boolean;
	address: string | undefined;
	email: string | undefined;
	userId: string | undefined;
	prfSupported: boolean;
}

interface AuthContextValue extends AuthState {
	/** Step 1: Send OTP to email */
	register: (email: string) => Promise<{ userId: string; isNewUser: boolean }>;
	/** Step 2: Verify OTP → get registration options */
	verifyOTP: (email: string, code: string) => Promise<{ userId: string; registrationOptions: unknown }>;
	/** Step 3: Register passkey → derive wallet → authenticate */
	completeRegistration: (userId: string) => Promise<void>;
	/** Login Step 1: Get login challenge */
	loginChallenge: (email: string) => Promise<void>;
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
	prfSupported: false,
	register: async () => ({ userId: '', isNewUser: true }),
	verifyOTP: async () => ({ userId: '', registrationOptions: {} }),
	completeRegistration: async () => {},
	loginChallenge: async () => {},
	logout: async () => {},
	checkSession: async () => {},
	refreshPRF: async () => { throw new Error('AuthContext not initialized'); },
});

// Cached RP_ID — in production this comes from the server/env, for now use window.location.hostname
function getRpId(): string {
	return window.location.hostname;
}

export function useAuthState(): AuthContextValue {
	const [state, setState] = useState<AuthState>({
		isAuthenticated: false,
		loading: true,
		address: undefined,
		email: undefined,
		userId: undefined,
		prfSupported: false,
	});

	// Store pending registration options from verifyOTP
	const registrationOptionsRef = useRef<unknown>(null);
	// Store login state for two-step login flow
	const loginStateRef = useRef<{ email: string; authOptions: unknown } | null>(null);

	// Check PRF support on mount
	useEffect(() => {
		isPRFSupported().then((supported) => {
			setState((prev) => ({ ...prev, prfSupported: supported }));
		});
	}, []);

	const checkSession = useCallback(async () => {
		try {
			const result = await api.get<{ address?: string; email?: string; userId?: string }>('/auth/me');
			setState((prev) => ({
				...prev,
				isAuthenticated: true,
				loading: false,
				address: result.address,
				email: result.email,
				userId: result.userId,
			}));
		} catch {
			setState((prev) => ({ ...prev, isAuthenticated: false, loading: false, address: undefined, email: undefined, userId: undefined }));
		}
	}, []);

	useEffect(() => {
		checkSession();
	}, [checkSession]);

	// Listen for 401/403 from API client → clear local auth state and redirect
	useEffect(() => {
		const handler = () => {
			setState((prev) => ({
				...prev,
				isAuthenticated: false,
				loading: false,
				address: undefined,
				email: undefined,
				userId: undefined,
			}));
		};
		authEvents.addEventListener(AUTH_EXPIRED_EVENT, handler);
		return () => authEvents.removeEventListener(AUTH_EXPIRED_EVENT, handler);
	}, []);

	const register = useCallback(async (email: string) => {
		const result = await api.post<{ userId: string; isNewUser: boolean }>('/auth/register', { email });
		return result;
	}, []);

	const verifyOTP = useCallback(async (email: string, code: string) => {
		const result = await api.post<{ userId: string; registrationOptions: unknown }>(
			'/auth/verify-email',
			{ email, code },
		);
		// Store registration options for the next step
		registrationOptionsRef.current = result.registrationOptions;
		return result;
	}, []);

	const completeRegistration = useCallback(async (userId: string) => {
		const options = registrationOptionsRef.current;
		if (!options) throw new Error('No registration options available. Call verifyOTP first.');

		// Register passkey with PRF using the server-generated options directly
		let regResult: WebAuthnRegistrationResult;
		try {
			regResult = await registerPasskeyWithPRF(options as Parameters<typeof registerPasskeyWithPRF>[0]);
		} catch (err) {
			registrationOptionsRef.current = null;
			throw err;
		}

		registrationOptionsRef.current = null;

		// Derive wallet from PRF if available, then wipe immediately
		let prfDerivedAddress: string | undefined;
		if (regResult.prfOutput) {
			const wallet = deriveEOAFromPRF(regResult.prfOutput);
			prfDerivedAddress = wallet.address;
			wipeKey(wallet);
			wipePRF(regResult.prfOutput);
		}

		// Forward the raw RegistrationResponseJSON from @simplewebauthn/browser to the server
		const serverResult = await api.post<{ email: string; address?: string; userId: string }>(
			'/auth/passkey/register',
			{
				userId,
				response: regResult.registrationResponseJSON,
				prfDerivedAddress,
			},
		);

		setState((prev) => ({
			...prev,
			isAuthenticated: true,
			loading: false,
			address: serverResult.address,
			email: serverResult.email,
			userId: serverResult.userId,
		}));
	}, []);

	const loginChallenge = useCallback(async (email: string) => {
		// Step 1: Get challenge from server
		const { authOptions } = await api.post<{ userId: string; authOptions: unknown }>(
			'/auth/passkey/login-challenge',
			{ email },
		);

		const opts = authOptions as {
			rpId: string;
			challenge: string;
			allowCredentials?: { id: string }[];
		};

		// Step 2: Authenticate with passkey + PRF
		let authResult: WebAuthnAuthResult;
		try {
			authResult = await authenticateWithPRF({
				rpId: opts.rpId,
				challenge: opts.challenge,
				allowCredentialIds: opts.allowCredentials?.map((c) => c.id) ?? [],
			});
		} catch (err) {
			throw err;
		}

		// Wipe PRF immediately — never stored in memory
		if (authResult.prfOutput) {
			wipePRF(authResult.prfOutput);
		}

		// Forward the raw AuthenticationResponseJSON from @simplewebauthn/browser to the server
		const serverResult = await api.post<{ email: string; address?: string; userId: string }>(
			'/auth/passkey/login',
			{
				email,
				response: authResult.authenticationResponseJSON,
			},
		);

		setState((prev) => ({
			...prev,
			isAuthenticated: true,
			loading: false,
			address: serverResult.address,
			email: serverResult.email,
			userId: serverResult.userId,
		}));
	}, []);

	/**
	 * Always-fresh PRF: triggers a passkey ceremony to get PRF output.
	 * The output is returned directly — it is NOT stored in memory.
	 * Caller is responsible for wiping it after use.
	 */
	const refreshPRF = useCallback(async (): Promise<Uint8Array> => {
		const email = state.email;
		console.log('[refreshPRF] Starting — email:', email, 'isAuthenticated:', state.isAuthenticated);
		if (!email) throw new Error('Not authenticated — no email on file.');

		// Get challenge from server
		console.log('[refreshPRF] Requesting login challenge...');
		let authOptions: unknown;
		try {
			const res = await api.post<{ userId: string; authOptions: unknown }>(
				'/auth/passkey/login-challenge',
				{ email },
			);
			authOptions = res.authOptions;
			console.log('[refreshPRF] Got challenge, authOptions keys:', Object.keys(authOptions as Record<string, unknown>));
		} catch (err) {
			console.error('[refreshPRF] login-challenge failed:', err);
			throw err;
		}

		const opts = authOptions as {
			rpId: string;
			challenge: string;
			allowCredentials?: { id: string }[];
		};

		console.log('[refreshPRF] Triggering passkey dialog — rpId:', opts.rpId, 'allowCredentials:', opts.allowCredentials?.length ?? 0);
		// Trigger passkey dialog
		let authResult: WebAuthnAuthResult;
		try {
			authResult = await authenticateWithPRF({
				rpId: opts.rpId,
				challenge: opts.challenge,
				allowCredentialIds: opts.allowCredentials?.map((c) => c.id) ?? [],
			});
			console.log('[refreshPRF] Passkey dialog completed — hasPRF:', !!authResult.prfOutput, 'credentialId:', authResult.credentialId?.slice(0, 10));
		} catch (err) {
			console.error('[refreshPRF] authenticateWithPRF failed:', err);
			throw err;
		}

		if (!authResult.prfOutput) {
			throw new Error('Passkey does not support PRF extension. Please re-register.');
		}

		// Validate with server (refreshes session too)
		console.log('[refreshPRF] Validating with server...');
		try {
			await api.post('/auth/passkey/login', {
				email,
				response: authResult.authenticationResponseJSON,
			});
			console.log('[refreshPRF] Server validation OK — session refreshed');
		} catch (err) {
			console.error('[refreshPRF] passkey/login validation failed:', err);
			throw err;
		}

		return authResult.prfOutput;
	}, [state.email, state.isAuthenticated]);

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
		}));
	}, []);

	return {
		...state,
		register,
		verifyOTP,
		completeRegistration,
		loginChallenge,
		logout,
		checkSession,
		refreshPRF,
	};
}

export function useAuth(): AuthContextValue {
	return useContext(AuthContext);
}
