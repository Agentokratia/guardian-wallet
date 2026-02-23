import type { Criterion, PolicyContext } from '@agentokratia/guardian-core';

export interface FailReason {
	/** Safe to return to any caller (no thresholds, addresses, or config details). */
	readonly short: string;
	/** Full diagnostic — for dashboard/audit only (includes exact values + limits). */
	readonly detail: string;
}

/**
 * Self-contained evaluator for a single criterion type.
 *
 * CRITICAL: method syntax (not arrow properties) for bivariant checking.
 * This allows CriterionEvaluator<EthValueCriterion> to be assignable to
 * CriterionEvaluator<Criterion> — required for the typed registry.
 */
export interface CriterionEvaluator<T extends Criterion = Criterion> {
	readonly type: T['type'];
	evaluate(criterion: T, ctx: PolicyContext): boolean;
	failReason(criterion: T, ctx: PolicyContext): FailReason;
}
