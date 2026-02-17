import { api } from '@/lib/api-client';
import { FALLBACK_NETWORKS } from '@/lib/network-meta';
import { useQuery } from '@tanstack/react-query';

export interface Network {
	id: string;
	name: string;
	displayName: string;
	chainId: number;
	rpcUrl: string;
	explorerUrl: string | null;
	nativeCurrency: string;
	isTestnet: boolean;
	enabled: boolean;
}

export function useNetworks() {
	return useQuery({
		queryKey: ['networks'],
		queryFn: async () => {
			try {
				const data = await api.get<Network[]>('/networks');
				return data && data.length > 0 ? data : FALLBACK_NETWORKS;
			} catch {
				return FALLBACK_NETWORKS;
			}
		},
		staleTime: 5 * 60 * 1000,
		placeholderData: FALLBACK_NETWORKS,
	});
}
