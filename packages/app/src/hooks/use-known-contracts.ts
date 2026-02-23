import { api } from '@/lib/api-client';
import { useQuery } from '@tanstack/react-query';

export interface KnownContract {
	id: string;
	protocol: string;
	name: string;
	address: string;
	chainId: number;
	contractType: string;
	verified: boolean;
	tags: string[];
}

export function useKnownContracts(chainId: number | undefined) {
	return useQuery({
		queryKey: ['known-contracts', chainId],
		queryFn: () => api.get<KnownContract[]>(`/contracts${chainId ? `?chainId=${chainId}` : ''}`),
		enabled: chainId !== undefined && chainId > 0,
		staleTime: 5 * 60 * 1000,
	});
}

/** Fetch ALL known contracts across all chains — used for label resolution. */
export function useAllKnownContracts() {
	return useQuery({
		queryKey: ['known-contracts', 'all'],
		queryFn: () => api.get<KnownContract[]>('/contracts'),
		staleTime: 5 * 60 * 1000,
	});
}
