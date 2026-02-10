import type { PolicyType } from '../enums/policy-type.js';

export interface SpendingLimitConfig {
	readonly maxWei: string;
}

export interface DailyLimitConfig {
	readonly maxWei: string;
}

export interface MonthlyLimitConfig {
	readonly maxWei: string;
}

export interface AllowedContractsConfig {
	readonly addresses: readonly string[];
	readonly allowDeploy: boolean;
}

export interface AllowedFunctionsConfig {
	readonly selectors: readonly string[];
}

export interface BlockedAddressesConfig {
	readonly addresses: readonly string[];
}

export interface RateLimitConfig {
	readonly maxPerHour: number;
}

export interface TimeWindowConfig {
	readonly startHour: number;
	readonly endHour: number;
	readonly timezone: string;
}

export type PolicyConfig =
	| SpendingLimitConfig
	| DailyLimitConfig
	| MonthlyLimitConfig
	| AllowedContractsConfig
	| AllowedFunctionsConfig
	| BlockedAddressesConfig
	| RateLimitConfig
	| TimeWindowConfig;

export interface Policy {
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
