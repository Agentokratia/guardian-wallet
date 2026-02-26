import { api } from '@/lib/api-client';
import { useMutation } from '@tanstack/react-query';

interface CreateSignerResult {
	signerId: string;
	ethAddress: string;
	apiKey: string;
	signerShare: string;
	userShare: string;
}

interface DKGInitResult {
	sessionId: string;
	signerId: string;
}

interface DKGFinalizeResult {
	signerId: string;
	ethAddress: string;
	signerShare: string;
	userShare: string;
}

export function useCreateSigner() {
	return useMutation({
		mutationFn: (data: {
			name: string;
			type: string;
			scheme: string;
			network?: string;
			description?: string;
		}) => api.post<CreateSignerResult>('/signers', data),
	});
}

// DKG with pool entries takes ~1s. Use generous timeout for safety.
const DKG_TIMEOUT_MS = 30_000;

export function useDKGInit() {
	return useMutation({
		mutationFn: (data: { signerId: string }) =>
			api.post<DKGInitResult>('/dkg/init', data, DKG_TIMEOUT_MS),
	});
}

export function useDKGFinalize() {
	return useMutation({
		mutationFn: (data: { sessionId: string; signerId: string }) =>
			api.post<DKGFinalizeResult>('/dkg/finalize', data, DKG_TIMEOUT_MS),
	});
}
