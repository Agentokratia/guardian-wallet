import type { EvmFunctionCriterion, PolicyContext } from '@agentokratia/guardian-core';
import type { CriterionEvaluator } from './types.js';

export const evmFunctionEvaluator: CriterionEvaluator<EvmFunctionCriterion> = {
	type: 'evmFunction',
	evaluate(c, ctx) {
		// Plain ETH transfer (no function selector)
		if (!ctx.functionSelector) {
			return c.allowPlainTransfer !== false; // default true
		}
		const lower = ctx.functionSelector.toLowerCase();
		return c.selectors.some((s) => s.toLowerCase() === lower);
	},
	failReason(_c, ctx) {
		return {
			short: 'Function not allowed',
			detail: `Function ${ctx.functionSelector ?? 'unknown'} is not in the allowed list`,
		};
	},
};
