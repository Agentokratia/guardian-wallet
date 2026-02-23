import type { PolicyTemplate } from '@/hooks/use-policy-templates';
import { api } from '@/lib/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';

interface CreateTemplateInput {
	name: string;
	slug: string;
	description?: string;
	icon?: string;
	rules: Record<string, unknown>[];
	chainIds?: number[];
	sortOrder?: number;
	visible?: boolean;
}

interface UpdateTemplateInput {
	id: string;
	name?: string;
	slug?: string;
	description?: string;
	icon?: string;
	rules?: Record<string, unknown>[];
	chainIds?: number[];
	sortOrder?: number;
	visible?: boolean;
}

export function useCreateTemplate() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: CreateTemplateInput) =>
			api.post<PolicyTemplate>('/policy-templates', input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['policy-templates'] });
		},
	});
}

export function useUpdateTemplate() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ id, ...data }: UpdateTemplateInput) =>
			api.put<PolicyTemplate>(`/policy-templates/${id}`, data),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['policy-templates'] });
		},
	});
}

export function useDeleteTemplate() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => api.del(`/policy-templates/${id}`),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['policy-templates'] });
		},
	});
}
