import type { PolicyRule } from '@agentokratia/guardian-core';

export interface PolicyDocumentEntity {
	readonly id: string;
	readonly signerId: string;
	readonly description?: string;
	readonly rules: readonly PolicyRule[];
	readonly version: number;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface PolicyDocumentRow {
	id: string;
	signer_id: string;
	description: string | null;
	rules: unknown;
	version: number;
	created_at: string;
	updated_at: string;
}
