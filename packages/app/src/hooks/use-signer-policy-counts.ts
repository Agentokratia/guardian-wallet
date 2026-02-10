import { api } from '@/lib/api-client';
import type { Policy } from '@/lib/types';
import { useQueries } from '@tanstack/react-query';

/**
 * Fetches policy counts for a list of signer IDs.
 * Returns a map of signerId -> policyCount.
 */
export function useSignerPolicyCounts(signerIds: string[]) {
	const queries = useQueries({
		queries: signerIds.map((signerId) => ({
			queryKey: ['policies', signerId],
			queryFn: () => api.get<Policy[]>(`/signers/${signerId}/policies`),
			enabled: !!signerId,
			staleTime: 30_000,
		})),
	});

	const isLoading = queries.some((q) => q.isLoading);

	const data: Record<string, number> = {};
	for (let i = 0; i < signerIds.length; i++) {
		const query = queries[i];
		if (query?.data) {
			data[signerIds[i]] = query.data.length;
		}
	}

	return {
		data: isLoading ? undefined : data,
		isLoading,
	};
}
