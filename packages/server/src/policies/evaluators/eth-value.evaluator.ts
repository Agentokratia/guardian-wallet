import type { EthValueCriterion, PolicyContext } from '@agentokratia/guardian-core';
import { compareValues, safeBigInt } from './helpers.js';
import type { CriterionEvaluator } from './types.js';

export const ethValueEvaluator: CriterionEvaluator<EthValueCriterion> = {
	type: 'ethValue',
	evaluate(c, ctx) {
		return compareValues(ctx.valueWei, c.operator, safeBigInt(c.value));
	},
	failReason() {
		return {
			short: 'ETH value limit exceeded',
			detail: 'Transaction value exceeds ETH limit',
		};
	},
};
