import type { EvmNetworkCriterion, PolicyContext } from '@agentokratia/guardian-core';
import type { CriterionEvaluator } from './types.js';

export const evmNetworkEvaluator: CriterionEvaluator<EvmNetworkCriterion> = {
	type: 'evmNetwork',
	evaluate(c, ctx) {
		// Empty allowlist → no network restriction configured → pass
		if (c.operator === 'in' && c.chainIds.length === 0) return true;

		const found = c.chainIds.includes(ctx.chainId);
		return c.operator === 'in' ? found : !found;
	},
	failReason(c, ctx) {
		return {
			short: 'Network not allowed',
			detail:
				c.operator === 'in'
					? `Chain ${ctx.chainId} is not in the allowed networks`
					: `Chain ${ctx.chainId} is blocked`,
		};
	},
};
