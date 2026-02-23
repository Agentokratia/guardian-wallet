import type { MaxPerTxUsdCriterion, PolicyContext } from '@agentokratia/guardian-core';
import type { CriterionEvaluator } from './types.js';

export const maxPerTxUsdEvaluator: CriterionEvaluator<MaxPerTxUsdCriterion> = {
	type: 'maxPerTxUsd',
	evaluate(c, ctx) {
		if (ctx.valueUsd === undefined) return false; // fail-closed: no price data → block
		return ctx.valueUsd <= c.maxUsd;
	},
	failReason(c, ctx) {
		return {
			short: 'Per-transaction limit exceeded',
			detail:
				ctx.valueUsd === undefined
					? 'Unable to determine USD value — price data unavailable (fail-closed)'
					: `Transaction value $${ctx.valueUsd.toFixed(2)} exceeds per-transaction limit of $${c.maxUsd.toLocaleString()}`,
		};
	},
};
