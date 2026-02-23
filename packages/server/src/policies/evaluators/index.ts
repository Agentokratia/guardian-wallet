/**
 * Criterion evaluator registry — typed, compile-time complete.
 *
 * Adding a new criterion:
 * 1. Add interface + union member in core/types/rules.ts
 * 2. Add CriterionMeta entry in core/criteria/catalog.ts
 * 3. Create evaluators/my-new.evaluator.ts (~30 lines)
 * 4. Add 1 line to EVALUATORS below
 *
 * Forget step 4 → TypeScript build fails (satisfies).
 */

import type { Criterion, PolicyContext } from '@agentokratia/guardian-core';
import { blockInfiniteApprovalsEvaluator } from './block-infinite-approvals.evaluator.js';
import { dailyLimitUsdEvaluator } from './daily-limit-usd.evaluator.js';
import { dailyLimitEvaluator } from './daily-limit.evaluator.js';
import { ethValueEvaluator } from './eth-value.evaluator.js';
import { evmAddressEvaluator } from './evm-address.evaluator.js';
import { evmFunctionEvaluator } from './evm-function.evaluator.js';
import { evmNetworkEvaluator } from './evm-network.evaluator.js';
import { ipAddressEvaluator } from './ip-address.evaluator.js';
import { maxPerTxUsdEvaluator } from './max-per-tx-usd.evaluator.js';
import { maxSlippageEvaluator } from './max-slippage.evaluator.js';
import { mevProtectionEvaluator } from './mev-protection.evaluator.js';
import { monthlyLimitUsdEvaluator } from './monthly-limit-usd.evaluator.js';
import { monthlyLimitEvaluator } from './monthly-limit.evaluator.js';
import { rateLimitEvaluator } from './rate-limit.evaluator.js';
import { timeWindowEvaluator } from './time-window.evaluator.js';
import type { CriterionEvaluator, FailReason } from './types.js';

// Re-export types for consumers
export type { CriterionEvaluator, FailReason } from './types.js';

// ─── Typed Registry ──────────────────────────────────────────────────────────

/**
 * Compile-time completeness check: every Criterion['type'] must have an evaluator.
 * Omitting one → TypeScript error at `satisfies`.
 */
type EvaluatorRegistryType = {
	[K in Criterion['type']]: CriterionEvaluator<Extract<Criterion, { type: K }>>;
};

const EVALUATORS = {
	ethValue: ethValueEvaluator,
	evmAddress: evmAddressEvaluator,
	evmNetwork: evmNetworkEvaluator,
	evmFunction: evmFunctionEvaluator,
	ipAddress: ipAddressEvaluator,
	rateLimit: rateLimitEvaluator,
	timeWindow: timeWindowEvaluator,
	dailyLimit: dailyLimitEvaluator,
	monthlyLimit: monthlyLimitEvaluator,
	maxPerTxUsd: maxPerTxUsdEvaluator,
	dailyLimitUsd: dailyLimitUsdEvaluator,
	monthlyLimitUsd: monthlyLimitUsdEvaluator,
	blockInfiniteApprovals: blockInfiniteApprovalsEvaluator,
	maxSlippage: maxSlippageEvaluator,
	mevProtection: mevProtectionEvaluator,
} satisfies EvaluatorRegistryType;

const REGISTRY: ReadonlyMap<Criterion['type'], CriterionEvaluator> = new Map(
	Object.values(EVALUATORS).map((e) => [e.type, e] as const),
);

// ─── Dispatchers ─────────────────────────────────────────────────────────────

/**
 * Evaluate a single criterion against the policy context.
 * Returns true if the criterion is satisfied.
 * Fail-closed: errors or unknown types → false.
 */
export function evaluateCriterion(criterion: Criterion, ctx: PolicyContext): boolean {
	try {
		const evaluator = REGISTRY.get(criterion.type);
		if (!evaluator) return false;
		return evaluator.evaluate(criterion, ctx);
	} catch {
		// Fail closed: any evaluation error → criterion not met
		return false;
	}
}

/**
 * Get a human-readable fail reason for a criterion that did not pass.
 */
export function criterionFailReason(criterion: Criterion, ctx: PolicyContext): FailReason {
	const evaluator = REGISTRY.get(criterion.type);
	if (!evaluator) {
		return {
			short: 'Policy check failed',
			detail: `Criterion ${criterion.type} not satisfied`,
		};
	}
	return evaluator.failReason(criterion, ctx);
}

// ─── Individual Evaluator Exports (for direct test imports) ──────────────────

export { ethValueEvaluator } from './eth-value.evaluator.js';
export { evmAddressEvaluator } from './evm-address.evaluator.js';
export { evmNetworkEvaluator } from './evm-network.evaluator.js';
export { evmFunctionEvaluator } from './evm-function.evaluator.js';
export { ipAddressEvaluator } from './ip-address.evaluator.js';
export { rateLimitEvaluator } from './rate-limit.evaluator.js';
export { timeWindowEvaluator } from './time-window.evaluator.js';
export { dailyLimitEvaluator } from './daily-limit.evaluator.js';
export { monthlyLimitEvaluator } from './monthly-limit.evaluator.js';
export { maxPerTxUsdEvaluator } from './max-per-tx-usd.evaluator.js';
export { dailyLimitUsdEvaluator } from './daily-limit-usd.evaluator.js';
export { monthlyLimitUsdEvaluator } from './monthly-limit-usd.evaluator.js';
export { blockInfiniteApprovalsEvaluator } from './block-infinite-approvals.evaluator.js';
export { maxSlippageEvaluator } from './max-slippage.evaluator.js';
export { mevProtectionEvaluator } from './mev-protection.evaluator.js';
