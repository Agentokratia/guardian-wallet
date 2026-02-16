import { api } from '@/lib/api-client';
import { formatWei } from '@/lib/formatters';
import { useQueries } from '@tanstack/react-query';

interface BalanceResponse {
	address: string;
	balances: { network: string; chainId: number; balance: string; rpcError?: boolean }[];
}

/**
 * Aggregates ETH balances across all signers into a single total.
 * Returns formatted total, per-signer balances, and loading state.
 */
export function usePortfolioBalance(signerIds: string[], chainId?: number) {
	const qs = chainId ? `?chainId=${chainId}` : '';
	const queries = useQueries({
		queries: signerIds.map((id) => ({
			queryKey: ['balance', id, chainId ?? 'all'],
			queryFn: () => api.get<BalanceResponse>(`/signers/${id}/balance${qs}`),
			enabled: !!id,
			refetchInterval: 60_000,
		})),
	});

	const isLoading = queries.some((q) => q.isLoading);

	let totalWei = 0n;
	const balances: Record<string, string> = {};
	const networkBalances: Record<string, { network: string; chainId: number; balance: string }[]> = {};

	for (let i = 0; i < signerIds.length; i++) {
		const q = queries[i];
		if (q?.data?.balances) {
			const signerTotal = q.data.balances.reduce((sum, b) => sum + BigInt(b.balance), 0n);
			totalWei += signerTotal;
			balances[signerIds[i]] = formatWei(signerTotal.toString());
			networkBalances[signerIds[i]] = q.data.balances;
		}
	}

	const totalFormatted = formatWei(totalWei.toString());

	return { totalFormatted, balances, networkBalances, isLoading };
}
