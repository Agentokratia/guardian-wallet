import { api } from '@/lib/api-client';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAccount, useDisconnect, useSignMessage } from 'wagmi';

interface AuthState {
	isAuthenticated: boolean;
	loading: boolean;
	address: string | undefined;
}

interface AuthContextValue extends AuthState {
	login: () => Promise<void>;
	logout: () => Promise<void>;
	checkSession: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
	isAuthenticated: false,
	loading: true,
	address: undefined,
	login: async () => {},
	logout: async () => {},
	checkSession: async () => {},
});

export function useAuthState(): AuthContextValue {
	const [state, setState] = useState<AuthState>({
		isAuthenticated: false,
		loading: true,
		address: undefined,
	});

	const { address, isConnected } = useAccount();
	const { signMessageAsync } = useSignMessage();
	const { openConnectModal } = useConnectModal();
	const { disconnect } = useDisconnect();

	const pendingLoginRef = useRef(false);

	const checkSession = useCallback(async () => {
		try {
			const result = await api.get<{ address: string }>('/auth/me');
			setState({ isAuthenticated: true, loading: false, address: result.address });
		} catch {
			setState({ isAuthenticated: false, loading: false, address: undefined });
		}
	}, []);

	useEffect(() => {
		checkSession();
	}, [checkSession]);

	const performSiweAuth = useCallback(async () => {
		const { nonce } = await api.get<{ nonce: string }>('/auth/nonce');
		const message = `Sign in to Guardian\nAddress: ${address}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
		const signature = await signMessageAsync({ message });
		const result = await api.post<{ verified: boolean; address: string }>(
			'/auth/wallet/verify',
			{ message, signature },
		);
		if (!result.verified) {
			throw new Error('Wallet verification failed');
		}
		setState({ isAuthenticated: true, loading: false, address: result.address });
	}, [signMessageAsync]);

	useEffect(() => {
		if (isConnected && address && pendingLoginRef.current) {
			pendingLoginRef.current = false;
			performSiweAuth().catch(() => {
				setState((prev) => ({ ...prev, loading: false }));
			});
		}
	}, [isConnected, address, performSiweAuth]);

	const login = useCallback(async () => {
		if (isConnected && address) {
			await performSiweAuth();
		} else {
			pendingLoginRef.current = true;
			openConnectModal?.();
		}
	}, [isConnected, address, performSiweAuth, openConnectModal]);

	const logout = useCallback(async () => {
		try {
			await api.post('/auth/logout');
		} catch (err) {
			console.warn('Logout API call failed — clearing local session anyway:', err);
		}
		disconnect();
		setState({ isAuthenticated: false, loading: false, address: undefined });
	}, [disconnect]);

	return {
		...state,
		login,
		logout,
		checkSession,
	};
}

export function useAuth(): AuthContextValue {
	return useContext(AuthContext);
}
