import { api } from '@/lib/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { KnownContract } from './use-known-contracts';

export function useAddContract() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (body: {
			protocol: string;
			name: string;
			address: string;
			chainId: number;
			contractType?: string;
			tags?: string[];
		}) => api.post<KnownContract>('/contracts', body),
		onSuccess: (_data, vars) => {
			qc.invalidateQueries({ queryKey: ['known-contracts', vars.chainId] });
			qc.invalidateQueries({ queryKey: ['known-contracts', undefined] });
		},
	});
}

export function useDeleteContract() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => api.del(`/contracts/${id}`),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['known-contracts'] });
		},
	});
}
