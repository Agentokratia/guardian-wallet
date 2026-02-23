import type { DailyLimitUsdCriterion, PolicyContext } from '@agentokratia/guardian-core';
import type { CriterionEvaluator } from './types.js';

export const dailyLimitUsdEvaluator: CriterionEvaluator<DailyLimitUsdCriterion> = {
	type: 'dailyLimitUsd',
	evaluate(c, ctx) {
		if (ctx.valueUsd === undefined || ctx.rollingDailySpendUsd === undefined) return false;
		return ctx.rollingDailySpendUsd + ctx.valueUsd <= c.maxUsd;
	},
	failReason(c, ctx) {
		return {
			short: 'Daily spending limit exceeded',
			detail:
				ctx.valueUsd === undefined || ctx.rollingDailySpendUsd === undefined
					? 'Unable to verify daily spend — price data unavailable (fail-closed)'
					: `Daily spend $${(ctx.rollingDailySpendUsd + ctx.valueUsd).toFixed(2)} would exceed daily limit of $${c.maxUsd.toLocaleString()}`,
		};
	},
};
