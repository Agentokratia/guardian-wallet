import type { PolicyType } from '../enums/policy-type.js';
import type { PolicyDocument } from '../types/rules.js';

export interface PolicyViolation {
	readonly policyId: string;
	readonly type: PolicyType;
	readonly reason: string;
	readonly config: Record<string, unknown>;
}

export interface PolicyResult {
	readonly allowed: boolean;
	readonly violations: readonly PolicyViolation[];
	readonly evaluatedCount: number;
	readonly evaluationTimeMs: number;
}

export interface PolicyContext {
	readonly signerAddress: string;
	readonly toAddress?: string;
	readonly valueWei: bigint;
	readonly functionSelector?: string;
	readonly chainId: number;
	readonly rollingDailySpendWei: bigint;
	readonly rollingMonthlySpendWei: bigint;
	readonly requestCountLastHour: number;
	readonly requestCountToday: number;
	readonly currentHourUtc: number;
	readonly timestamp: Date;
	/** Raw calldata hex (e.g. "0x..."). */
	readonly txData?: string;
	/** Request IP for ipAddress criterion. */
	readonly callerIp?: string;
}

export interface IPolicyEngine {
	evaluate(
		policies: ReadonlyArray<{
			id: string;
			type: PolicyType;
			config: Record<string, unknown>;
			enabled: boolean;
		}>,
		context: PolicyContext,
	): Promise<PolicyResult>;
}

export interface IRulesEngine {
	evaluate(
		document: PolicyDocument | null,
		context: PolicyContext,
	): Promise<PolicyResult>;
}
