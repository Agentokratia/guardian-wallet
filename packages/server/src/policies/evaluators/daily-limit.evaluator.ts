import type { DailyLimitCriterion, PolicyContext } from '@agentokratia/guardian-core';
import { safeBigInt } from './helpers.js';
import type { CriterionEvaluator } from './types.js';

export const dailyLimitEvaluator: CriterionEvaluator<DailyLimitCriterion> = {
	type: 'dailyLimit',
	evaluate(c, ctx) {
		const maxWei = safeBigInt(c.maxWei);
		return ctx.rollingDailySpendWei + ctx.valueWei <= maxWei;
	},
	failReason() {
		return {
			short: 'Daily ETH limit exceeded',
			detail: 'Rolling 24h spend exceeds daily ETH limit',
		};
	},
};
