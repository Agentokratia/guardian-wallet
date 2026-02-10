import type { PolicyConfig, PolicyType } from '@agentokratia/guardian-core';

export interface PolicyEntity {
	readonly id: string;
	readonly signerId: string;
	readonly type: PolicyType;
	readonly config: PolicyConfig;
	readonly enabled: boolean;
	readonly appliesTo?: readonly string[];
	readonly timesTriggered: number;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface PolicyRow {
	id: string;
	signer_id: string;
	type: string;
	config: Record<string, unknown>;
	enabled: boolean;
	applies_to: string[] | null;
	times_triggered: number;
	created_at: string;
	updated_at: string;
}

export interface CreatePolicyDto {
	readonly signerId: string;
	readonly type: PolicyType;
	readonly config: Record<string, unknown>;
	readonly enabled?: boolean;
	readonly appliesTo?: readonly string[];
}

export interface UpdatePolicyDto {
	readonly config?: Record<string, unknown>;
	readonly enabled?: boolean;
	readonly appliesTo?: readonly string[];
}
