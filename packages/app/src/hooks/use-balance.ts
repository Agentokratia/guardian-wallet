import { api } from '@/lib/api-client';
import { formatWei } from '@/lib/formatters';
import { useQueries, useQuery } from '@tanstack/react-query';

export interface NetworkBalance {
	network: string;
	chainId: number;
	balance: string;
	rpcError?: boolean;
}

interface BalanceResponse {
	address: string;
	balances: NetworkBalance[];
}

export function useBalance(signerId: string, chainId?: number) {
	const qs = chainId ? `?chainId=${chainId}` : '';
	return useQuery({
		queryKey: ['balance', signerId, chainId ?? 'all'],
		queryFn: () => api.get<BalanceResponse>(`/signers/${signerId}/balance${qs}`),
		enabled: !!signerId,
		refetchInterval: 30_000,
	});
}

/**
 * Fetch ETH balances for multiple signers in parallel.
 * When chainId is provided, queries only that chain (faster + more reliable).
 * Returns a record of signerId → total formatted ETH balance string.
 */
export function useSignerBalances(signerIds: string[], chainId?: number) {
	const qs = chainId ? `?chainId=${chainId}` : '';
	const queries = useQueries({
		queries: signerIds.map((id) => ({
			queryKey: ['balance', id, chainId ?? 'all'],
			queryFn: () => api.get<BalanceResponse>(`/signers/${id}/balance${qs}`),
			enabled: !!id,
			refetchInterval: 60_000,
		})),
	});

	const balances: Record<string, string> = {};
	for (let i = 0; i < signerIds.length; i++) {
		const q = queries[i];
		if (q?.data?.balances) {
			const total = q.data.balances.reduce((sum, b) => sum + BigInt(b.balance), 0n);
			balances[signerIds[i]] = formatWei(total.toString());
		}
	}

	return { data: balances };
}
