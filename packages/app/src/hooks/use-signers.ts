import { api } from '@/lib/api-client';
import type { Signer } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';

export function useSigners() {
	return useQuery({
		queryKey: ['signers'],
		queryFn: () => api.get<Signer[]>('/signers'),
	});
}
