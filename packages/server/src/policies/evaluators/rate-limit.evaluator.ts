import type { PolicyContext, RateLimitCriterion } from '@agentokratia/guardian-core';
import type { CriterionEvaluator } from './types.js';

export const rateLimitEvaluator: CriterionEvaluator<RateLimitCriterion> = {
	type: 'rateLimit',
	evaluate(c, ctx) {
		return ctx.requestCountLastHour < c.maxPerHour;
	},
	failReason(c, ctx) {
		return {
			short: 'Rate limit exceeded',
			detail: `Rate limit exceeded: ${ctx.requestCountLastHour}/${c.maxPerHour} requests this hour`,
		};
	},
};
