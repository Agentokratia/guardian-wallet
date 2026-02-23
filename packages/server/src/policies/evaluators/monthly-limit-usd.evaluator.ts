import type { MonthlyLimitUsdCriterion, PolicyContext } from '@agentokratia/guardian-core';
import type { CriterionEvaluator } from './types.js';

export const monthlyLimitUsdEvaluator: CriterionEvaluator<MonthlyLimitUsdCriterion> = {
	type: 'monthlyLimitUsd',
	evaluate(c, ctx) {
		if (ctx.valueUsd === undefined || ctx.rollingMonthlySpendUsd === undefined) return false;
		return ctx.rollingMonthlySpendUsd + ctx.valueUsd <= c.maxUsd;
	},
	failReason(c, ctx) {
		return {
			short: 'Monthly spending limit exceeded',
			detail:
				ctx.valueUsd === undefined || ctx.rollingMonthlySpendUsd === undefined
					? 'Unable to verify monthly spend — price data unavailable (fail-closed)'
					: `Monthly spend $${(ctx.rollingMonthlySpendUsd + ctx.valueUsd).toFixed(2)} would exceed monthly limit of $${c.maxUsd.toLocaleString()}`,
		};
	},
};
