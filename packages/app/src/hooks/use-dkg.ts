import { api } from '@/lib/api-client';
import { useMutation } from '@tanstack/react-query';

interface CreateSignerResult {
	signer: {
		id: string;
		name: string;
		ethAddress: string;
		status: string;
	};
	apiKey: string;
}

interface DKGInitResult {
	sessionId: string;
	signerId: string;
	round: number;
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

export function useDKGInit() {
	return useMutation({
		mutationFn: (data: { signerId: string }) =>
			api.post<DKGInitResult>('/dkg/init', data),
	});
}

export function useDKGFinalize() {
	return useMutation({
		mutationFn: (data: { sessionId: string; signerId: string }) =>
			api.post<DKGFinalizeResult>('/dkg/finalize', data),
	});
}
