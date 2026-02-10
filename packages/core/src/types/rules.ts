/** Rules engine types — composable, ordered policy rules. */

// ─── Operators ───────────────────────────────────────────────────────────────

export type ComparisonOperator = '<=' | '<' | '>=' | '>' | '=';
export type SetOperator = 'in' | 'not_in';

// ─── Individual Criterion Interfaces ─────────────────────────────────────────

export interface EthValueCriterion {
	readonly type: 'ethValue';
	readonly operator: ComparisonOperator;
	/** Wei amount as decimal string (avoids JSON BigInt issues). */
	readonly value: string;
}

export interface EvmAddressCriterion {
	readonly type: 'evmAddress';
	readonly operator: SetOperator;
	readonly addresses: readonly string[];
	/** Allow contract deployment (to=null). Default false. */
	readonly allowDeploy?: boolean;
}

export interface EvmNetworkCriterion {
	readonly type: 'evmNetwork';
	readonly operator: SetOperator;
	readonly chainIds: readonly number[];
}

export interface EvmFunctionCriterion {
	readonly type: 'evmFunction';
	/** 4-byte hex function selectors (e.g. "0xa9059cbb"). */
	readonly selectors: readonly string[];
	/** Allow plain ETH transfer (no calldata). Default true. */
	readonly allowPlainTransfer?: boolean;
}

export interface IpAddressCriterion {
	readonly type: 'ipAddress';
	readonly operator: SetOperator;
	/** IPv4 or CIDR notation (e.g. "10.0.0.0/8"). */
	readonly ips: readonly string[];
}

export interface RateLimitCriterion {
	readonly type: 'rateLimit';
	readonly maxPerHour: number;
}

export interface TimeWindowCriterion {
	readonly type: 'timeWindow';
	/** 0–23 UTC hour. */
	readonly startHour: number;
	/** 0–23 UTC hour. Overnight ranges supported (e.g. 22 → 6). */
	readonly endHour: number;
}

export interface DailyLimitCriterion {
	readonly type: 'dailyLimit';
	/** Rolling 24h spend cap in wei (decimal string). */
	readonly maxWei: string;
}

export interface MonthlyLimitCriterion {
	readonly type: 'monthlyLimit';
	/** Rolling 30-day spend cap in wei (decimal string). */
	readonly maxWei: string;
}

// ─── Discriminated Union ─────────────────────────────────────────────────────

export type Criterion =
	| EthValueCriterion
	| EvmAddressCriterion
	| EvmNetworkCriterion
	| EvmFunctionCriterion
	| IpAddressCriterion
	| RateLimitCriterion
	| TimeWindowCriterion
	| DailyLimitCriterion
	| MonthlyLimitCriterion;

// ─── Rule & Document ─────────────────────────────────────────────────────────

export type RuleAction = 'accept' | 'reject';

export interface PolicyRule {
	readonly action: RuleAction;
	readonly criteria: readonly Criterion[];
	readonly description?: string;
	readonly enabled?: boolean;
}

export interface PolicyDocument {
	readonly id: string;
	readonly signerId: string;
	readonly description?: string;
	readonly rules: readonly PolicyRule[];
	readonly version: number;
	readonly createdAt: string;
	readonly updatedAt: string;
}
