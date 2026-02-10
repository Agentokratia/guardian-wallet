import { api } from '@/lib/api-client';
import { useQuery } from '@tanstack/react-query';

export interface TokenBalance {
	id: string;
	symbol: string;
	name: string;
	address: string | null;
	decimals: number;
	isNative: boolean;
	logoUrl: string | null;
	source: 'network' | 'custom';
	balance: string;
}

interface TokenBalancesResponse {
	address: string;
	chainId: number;
	tokens: TokenBalance[];
}

export function useTokenBalances(signerId: string, chainId?: number) {
	return useQuery({
		queryKey: ['token-balances', signerId, chainId],
		queryFn: () =>
			api.get<TokenBalancesResponse>(
				`/signers/${signerId}/token-balances${chainId ? `?chainId=${chainId}` : ''}`,
			),
		enabled: !!signerId && !!chainId,
		refetchInterval: 30_000,
	});
}
