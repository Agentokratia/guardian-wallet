import type { PolicyType } from '../enums/policy-type.js';

export interface Policy {
	readonly id: string;
	readonly signerId: string;
	readonly type: PolicyType;
	readonly config: Record<string, unknown>;
	readonly enabled: boolean;
	readonly appliesTo?: readonly string[];
	readonly timesTriggered: number;
	readonly createdAt: string;
	readonly updatedAt: string;
}
