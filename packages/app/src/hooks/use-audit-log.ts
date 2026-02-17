import { api } from '@/lib/api-client';
import type { SigningRequest } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';

interface AuditLogFilters {
	signerId?: string;
	status?: string;
	requestType?: string;
	from?: string;
	to?: string;
	limit?: number;
}

export function useAuditLog(filters?: AuditLogFilters) {
	const params = new URLSearchParams();
	if (filters?.signerId) params.set('signerId', filters.signerId);
	if (filters?.status) params.set('status', filters.status);
	if (filters?.requestType) params.set('requestType', filters.requestType);
	if (filters?.from) params.set('from', filters.from);
	if (filters?.to) params.set('to', filters.to);
	params.set('limit', String(filters?.limit ?? 50));
	return useQuery({
		queryKey: ['audit-log', filters],
		queryFn: async () => {
			const res = await api.get<{
				data: SigningRequest[];
				meta: { total: number; page: number; limit: number; totalPages: number };
			}>(`/audit-log?${params}`);
			return res.data;
		},
	});
}
