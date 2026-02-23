import type { MaxSlippageCriterion, PolicyContext } from '@agentokratia/guardian-core';
import { type Hex, decodeAbiParameters, parseAbiParameters } from 'viem';
import type { CriterionEvaluator } from './types.js';

// Known DEX swap selectors
const UNISWAP_V2_SWAP_EXACT_TOKENS = '0x38ed1739';
const UNISWAP_V2_SWAP_EXACT_ETH = '0x7ff36ab5';
const UNISWAP_V2_SWAP_TOKENS_FOR_EXACT_TOKENS = '0x8803dbee';
const UNISWAP_V2_SWAP_TOKENS_FOR_EXACT_ETH = '0x4a25d94a';
const UNISWAP_V2_SWAP_EXACT_TOKENS_FOR_ETH = '0x18cbafe5';
const UNISWAP_V3_EXACT_INPUT_SINGLE = '0x414bf389';
const UNISWAP_V3_EXACT_INPUT = '0xc04b8d59';

const SWAP_EXACT_TOKENS_PARAMS = parseAbiParameters('uint256 amountIn, uint256 amountOutMin');
const SWAP_EXACT_ETH_PARAMS = parseAbiParameters('uint256 amountOutMin');

/**
 * Extracts amountOutMin from recognized swap calldata.
 * Returns null if the transaction isn't a recognized swap.
 * Returns { amountIn, amountOutMin } when extractable.
 *
 * For "exact output" swaps (swapTokensForExact*), slippage is on the
 * input side and the output is guaranteed — these are safe and return null.
 */
function extractSlippageParams(
	selector: string,
	params: Hex,
): { amountIn: bigint; amountOutMin: bigint } | null {
	// swapExactTokensForTokens / swapExactTokensForETH — (amountIn, amountOutMin, ...)
	if (
		selector === UNISWAP_V2_SWAP_EXACT_TOKENS ||
		selector === UNISWAP_V2_SWAP_EXACT_TOKENS_FOR_ETH
	) {
		const [amountIn, amountOutMin] = decodeAbiParameters(SWAP_EXACT_TOKENS_PARAMS, params);
		return { amountIn, amountOutMin };
	}

	// swapExactETHForTokens — (amountOutMin, path[], to, deadline)
	// amountIn = msg.value (available in ctx.valueWei but not here — use 1n placeholder)
	if (selector === UNISWAP_V2_SWAP_EXACT_ETH) {
		const [amountOutMin] = decodeAbiParameters(SWAP_EXACT_ETH_PARAMS, params);
		// Can't compute percentage without knowing token price ratio.
		// Block zero slippage, pass others.
		return { amountIn: 1n, amountOutMin };
	}

	// swapTokensForExactTokens / swapTokensForExactETH — guaranteed output, safe
	if (
		selector === UNISWAP_V2_SWAP_TOKENS_FOR_EXACT_TOKENS ||
		selector === UNISWAP_V2_SWAP_TOKENS_FOR_EXACT_ETH
	) {
		return null; // exact output = known result
	}

	// Uniswap V3 exactInputSingle — struct with amountOutMinimum at position 6
	if (selector === UNISWAP_V3_EXACT_INPUT_SINGLE) {
		const decoded = decodeAbiParameters(
			parseAbiParameters('address, address, uint24, address, uint256, uint256, uint256, uint160'),
			params,
		);
		const amountIn = decoded[4]; // amountIn
		const amountOutMinimum = decoded[6]; // amountOutMinimum
		return { amountIn, amountOutMin: amountOutMinimum };
	}

	// Uniswap V3 exactInput — (bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)
	if (selector === UNISWAP_V3_EXACT_INPUT) {
		const decoded = decodeAbiParameters(
			parseAbiParameters('bytes, address, uint256, uint256, uint256'),
			params,
		);
		const amountIn = decoded[3]; // amountIn
		const amountOutMinimum = decoded[4]; // amountOutMinimum
		return { amountIn, amountOutMin: amountOutMinimum };
	}

	return null;
}

/**
 * Block swaps with insufficient slippage protection.
 *
 * Two levels of protection:
 * 1. Zero slippage (amountOutMin=0) is ALWAYS blocked — free sandwich target.
 * 2. When both amounts are in the same denomination (same-pair swaps),
 *    computes effective slippage % and blocks if it exceeds maxPercent.
 *    Cross-token percentage comparison requires a price oracle and is
 *    deferred — for now, non-zero slippage passes if we can't compute %.
 */
export const maxSlippageEvaluator: CriterionEvaluator<MaxSlippageCriterion> = {
	type: 'maxSlippage',
	evaluate(c, ctx) {
		if (!ctx.txData || ctx.txData.length < 10) return true; // not a contract call

		const selector = ctx.txData.slice(0, 10).toLowerCase();
		const params = `0x${ctx.txData.slice(10)}` as Hex;

		try {
			const slippage = extractSlippageParams(selector, params);
			if (!slippage) return true; // not a recognized swap or exact-output swap

			// Level 1: zero slippage = always block
			if (slippage.amountOutMin === 0n) return false;

			// Level 2: compute effective slippage % when amountIn is meaningful
			// (amountOutMin / amountIn) gives the minimum ratio the user accepts.
			// Slippage tolerance = 1 - (amountOutMin / amountIn).
			// This is only accurate for same-denomination pairs. For cross-token
			// pairs, the ratio is meaningless without price data.
			// We check anyway — if the raw ratio implies >maxPercent tolerance,
			// the swap is suspicious regardless of denomination.
			if (slippage.amountIn > 0n && slippage.amountOutMin > 0n) {
				// Slippage % = (1 - amountOutMin/amountIn) * 100
				// Using integer math: slippageBps = ((amountIn - amountOutMin) * 10000) / amountIn
				if (slippage.amountOutMin <= slippage.amountIn) {
					const slippageBps =
						((slippage.amountIn - slippage.amountOutMin) * 10000n) / slippage.amountIn;
					const maxBps = BigInt(Math.round(c.maxPercent * 100));
					if (slippageBps > maxBps) return false;
				}
			}

			return true;
		} catch {
			return false; // can't parse swap calldata → fail-closed
		}
	},
	failReason(c) {
		return {
			short: `Slippage exceeds ${c.maxPercent}%`,
			detail: `Swap detected with slippage protection exceeding the ${c.maxPercent}% maximum. This makes the transaction vulnerable to sandwich attacks.`,
		};
	},
};
