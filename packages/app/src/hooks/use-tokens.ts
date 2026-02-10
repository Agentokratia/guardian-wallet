import { api } from '@/lib/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';

interface AddTokenInput {
	signerId: string;
	chainId: number;
	address: string;
	symbol: string;
	name: string;
	decimals?: number;
}

export function useAddToken() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ signerId, ...body }: AddTokenInput) =>
			api.post(`/signers/${signerId}/tokens`, body),
		onSuccess: (_data, variables) => {
			qc.invalidateQueries({ queryKey: ['token-balances', variables.signerId] });
		},
	});
}

export function useRemoveToken() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ signerId, tokenId }: { signerId: string; tokenId: string }) =>
			api.del(`/signers/${signerId}/tokens/${tokenId}`),
		onSuccess: (_data, variables) => {
			qc.invalidateQueries({ queryKey: ['token-balances', variables.signerId] });
		},
	});
}
