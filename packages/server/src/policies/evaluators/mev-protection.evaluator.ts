import type { MevProtectionCriterion, PolicyContext } from '@agentokratia/guardian-core';
import type { CriterionEvaluator } from './types.js';

/**
 * Blocks swap transactions when MEV protection is enabled.
 * Detects swaps by function selector (Uniswap V2/V3, 1inch, etc).
 * Non-swap transactions always pass — they're not MEV-vulnerable.
 *
 * To allow swaps: use a dedicated signer without this criterion,
 * or disable MEV protection for that signer's policy.
 */
const DEX_SELECTORS = new Set([
	'0x38ed1739', // swapExactTokensForTokens
	'0x7ff36ab5', // swapExactETHForTokens
	'0x8803dbee', // swapTokensForExactTokens
	'0x4a25d94a', // swapTokensForExactETH
	'0x18cbafe5', // swapExactTokensForETH
	'0x414bf389', // V3 exactInputSingle
	'0xc04b8d59', // V3 exactInput
	'0xdb3e2198', // V3 exactOutputSingle
	'0xf28c0498', // V3 exactOutput
	'0x5ae401dc', // V3 multicall (often wraps swaps)
	'0x2cc4081e', // 1inch swap
	'0x12aa3caf', // 1inch swap v5
	'0x0502b1c5', // 1inch unoswap
	'0xe449022e', // 1inch uniswapV3Swap
]);

function isSwapTransaction(txData?: string): boolean {
	if (!txData || txData.length < 10) return false;
	return DEX_SELECTORS.has(txData.slice(0, 10).toLowerCase());
}

export const mevProtectionEvaluator: CriterionEvaluator<MevProtectionCriterion> = {
	type: 'mevProtection',
	evaluate(c, ctx) {
		if (!c.enabled) return true;
		// Block swap transactions that aren't using private relay.
		// Non-swap transactions pass — they're not MEV-vulnerable.
		return !isSwapTransaction(ctx.txData);
	},
	failReason() {
		return {
			short: 'MEV protection required',
			detail:
				'Swap transaction detected without MEV protection. Route through a private relay (Flashbots Protect, MEV Blocker) or disable MEV protection for this signer.',
		};
	},
};
