import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

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
		queryFn: () => api.get<Network[]>('/networks'),
		staleTime: 5 * 60 * 1000,
	});
}
