import { api } from '@/lib/api-client';
import { useQuery } from '@tanstack/react-query';

interface HealthResponse {
	status: string;
	uptime: number;
	vault: { connected: boolean };
	db: boolean;
}

export function useHealth() {
	return useQuery({
		queryKey: ['health'],
		queryFn: () => api.get<HealthResponse>('/health'),
		refetchInterval: 60_000,
	});
}
