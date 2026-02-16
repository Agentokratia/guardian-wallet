import { useQueries } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { TokenBalance } from './use-token-balances';

interface TokenBalancesResponse {
	address: string;
	chainId: number;
	tokens: TokenBalance[];
}

export interface NetworkTokenGroup {
	network: string;
	chainId: number;
	tokens: TokenBalance[];
	isLoading: boolean;
}

/**
 * Fetches token balances for every network in parallel.
 * Returns tokens grouped by network — no filtering needed.
 */
export function useAllTokenBalances(
	signerId: string,
	networkChainIds: { network: string; chainId: number }[],
) {
	const queries = useQueries({
		queries: networkChainIds.map(({ chainId }) => ({
			queryKey: ['token-balances', signerId, chainId],
			queryFn: () =>
				api.get<TokenBalancesResponse>(
					`/signers/${signerId}/token-balances?chainId=${chainId}`,
				),
			enabled: !!signerId && !!chainId,
			refetchInterval: 30_000,
		})),
	});

	const groups: NetworkTokenGroup[] = networkChainIds.map((nc, i) => ({
		network: nc.network,
		chainId: nc.chainId,
		tokens: queries[i]?.data?.tokens ?? [],
		isLoading: queries[i]?.isLoading ?? false,
	}));

	const isLoading = queries.some((q) => q.isLoading);

	return { groups, isLoading };
}
