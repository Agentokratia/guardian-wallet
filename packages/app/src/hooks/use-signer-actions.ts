import { api } from '@/lib/api-client';
import type { Signer } from '@/lib/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export function usePauseSigner() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => api.post<Signer>(`/signers/${id}/pause`),
		onSuccess: (_data, id) => {
			qc.invalidateQueries({ queryKey: ['signer', id] });
			qc.invalidateQueries({ queryKey: ['signers'] });
		},
	});
}

export function useResumeSigner() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => api.post<Signer>(`/signers/${id}/resume`),
		onSuccess: (_data, id) => {
			qc.invalidateQueries({ queryKey: ['signer', id] });
			qc.invalidateQueries({ queryKey: ['signers'] });
		},
	});
}

export function useRevokeSigner() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => api.del<Signer>(`/signers/${id}`),
		onSuccess: (_data, id) => {
			qc.invalidateQueries({ queryKey: ['signer', id] });
			qc.invalidateQueries({ queryKey: ['signers'] });
		},
	});
}
