import { api } from '@/lib/api-client';
import { useQuery } from '@tanstack/react-query';

export interface PolicyTemplate {
	id: string;
	slug: string;
	name: string;
	description: string;
	icon: string;
	rules: Record<string, unknown>[];
	chainIds: number[];
	sortOrder: number;
	visible: boolean;
}

export function usePolicyTemplates() {
	return useQuery({
		queryKey: ['policy-templates'],
		queryFn: () => api.get<PolicyTemplate[]>('/policy-templates'),
		staleTime: 10 * 60 * 1000,
	});
}

export function useAllPolicyTemplates() {
	return useQuery({
		queryKey: ['policy-templates', 'admin'],
		queryFn: () => api.get<PolicyTemplate[]>('/policy-templates/admin'),
		staleTime: 60 * 1000,
	});
}
