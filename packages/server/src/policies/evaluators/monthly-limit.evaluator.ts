import type { MonthlyLimitCriterion, PolicyContext } from '@agentokratia/guardian-core';
import { safeBigInt } from './helpers.js';
import type { CriterionEvaluator } from './types.js';

export const monthlyLimitEvaluator: CriterionEvaluator<MonthlyLimitCriterion> = {
	type: 'monthlyLimit',
	evaluate(c, ctx) {
		const maxWei = safeBigInt(c.maxWei);
		return ctx.rollingMonthlySpendWei + ctx.valueWei <= maxWei;
	},
	failReason() {
		return {
			short: 'Monthly ETH limit exceeded',
			detail: 'Rolling 30d spend exceeds monthly ETH limit',
		};
	},
};
