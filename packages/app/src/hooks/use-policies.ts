import { api } from '@/lib/api-client';
import type { Policy, PolicyDocumentResponse } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// ─── Policy Document (new) ────────────────────────────────────────

export function usePolicy(signerId: string) {
	return useQuery({
		queryKey: ['policy-document', signerId],
		queryFn: () => api.get<PolicyDocumentResponse>(`/signers/${signerId}/policy`),
		enabled: !!signerId,
	});
}

export function useSavePolicy() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			signerId,
			rules,
			description,
		}: {
			signerId: string;
			rules: Record<string, unknown>[];
			description?: string;
		}) => api.put<PolicyDocumentResponse>(`/signers/${signerId}/policy`, { rules, description }),
		onSuccess: (_data, variables) => {
			qc.invalidateQueries({ queryKey: ['policy-document', variables.signerId] });
		},
	});
}

// ─── Draft / Activate / Backtest ─────────────────────────────────────────────

export function usePolicyDraft(signerId: string) {
	return useQuery({
		queryKey: ['policy-draft', signerId],
		queryFn: () => api.get<PolicyDocumentResponse>(`/signers/${signerId}/policy/draft`),
		enabled: !!signerId,
	});
}

export function useSavePolicyDraft() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			signerId,
			rules,
			description,
		}: {
			signerId: string;
			rules: Record<string, unknown>[];
			description?: string;
		}) =>
			api.put<PolicyDocumentResponse>(`/signers/${signerId}/policy/draft`, {
				rules,
				description,
			}),
		onSuccess: (_data, variables) => {
			qc.invalidateQueries({ queryKey: ['policy-draft', variables.signerId] });
		},
	});
}

export function useActivatePolicy() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (signerId: string) =>
			api.post<PolicyDocumentResponse>(`/signers/${signerId}/policy/activate`, {}),
		onSuccess: (_data, signerId) => {
			qc.invalidateQueries({ queryKey: ['policy-document', signerId] });
			qc.invalidateQueries({ queryKey: ['policy-draft', signerId] });
		},
	});
}

export interface BacktestResult {
	totalAnalyzed: number;
	wouldPass: number;
	wouldBlock: number;
	blockedRequests: {
		requestId: string;
		toAddress: string | null;
		valueWei: string | null;
		valueUsd: number | null;
		decodedAction: string | null;
		createdAt: string;
		reasons: string[];
	}[];
}

export function useBacktestPolicy() {
	return useMutation({
		mutationFn: (signerId: string) =>
			api.post<BacktestResult>(`/signers/${signerId}/policy/backtest`, {}),
	});
}

// ─── Legacy CRUD (kept for backward compatibility) ──────────────────────────

export function usePolicies(signerId: string) {
	return useQuery({
		queryKey: ['policies', signerId],
		queryFn: () => api.get<Policy[]>(`/signers/${signerId}/policies`),
		enabled: !!signerId,
	});
}

export function useTogglePolicy() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
			api.patch(`/policies/${id}`, { enabled }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
	});
}

export function useCreatePolicy() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			signerId,
			...data
		}: {
			signerId: string;
			type: string;
			config: Record<string, unknown>;
			enabled: boolean;
		}) => api.post<Policy>(`/signers/${signerId}/policies`, data),
		onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
	});
}

export function useUpdatePolicy() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			id,
			...data
		}: {
			id: string;
			config?: Record<string, unknown>;
			enabled?: boolean;
		}) => api.patch<Policy>(`/policies/${id}`, data),
		onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
	});
}

export function useDeletePolicy() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => api.del(`/policies/${id}`),
		onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
	});
}
