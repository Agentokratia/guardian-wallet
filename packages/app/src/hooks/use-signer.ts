import { api } from '@/lib/api-client';
import type { Signer } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';

export function useSigner(id: string) {
	return useQuery({
		queryKey: ['signer', id],
		queryFn: () => api.get<Signer>(`/signers/${id}`),
		enabled: !!id,
	});
}
