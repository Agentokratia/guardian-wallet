import type { PolicyRule } from '@agentokratia/guardian-core';

export type PolicyDocumentStatus = 'active';

export interface PolicyDocumentEntity {
	readonly id: string;
	readonly signerId: string;
	readonly description?: string;
	readonly rules: readonly PolicyRule[];
	readonly version: number;
	readonly status: PolicyDocumentStatus;
	readonly activatedAt?: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface PolicyDocumentRow {
	id: string;
	signer_id: string;
	description: string | null;
	rules: unknown;
	version: number;
	status: string;
	activated_at: string | null;
	created_at: string;
	updated_at: string;
}
