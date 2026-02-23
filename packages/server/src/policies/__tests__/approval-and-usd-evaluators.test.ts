/**
 * Tests for approval-blocking evaluators (ERC-20, increaseAllowance, Permit2, setApprovalForAll),
 * USD limit evaluators, and the buildRules → RulesEngine integration path.
 */

import type { PolicyContext, PolicyDocument } from '@agentokratia/guardian-core';
import { PolicyType } from '@agentokratia/guardian-core';
import { describe, expect, it } from 'vitest';
import {
	blockInfiniteApprovalsEvaluator,
	dailyLimitUsdEvaluator,
	evaluateCriterion,
	maxPerTxUsdEvaluator,
	maxSlippageEvaluator,
	mevProtectionEvaluator,
	monthlyLimitUsdEvaluator,
} from '../evaluators/index.js';
import { RulesEngineProvider } from '../rules-engine.provider.js';

// ─── Test calldata fixtures (pre-encoded ABI) ────────────────────────────────

/** approve(0x1111...1111, MAX_UINT256) */
const APPROVE_MAX =
	'0x095ea7b30000000000000000000000001111111111111111111111111111111111111111ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

/** approve(0x1111...1111, 1000) */
const APPROVE_SMALL =
	'0x095ea7b3000000000000000000000000111111111111111111111111111111111111111100000000000000000000000000000000000000000000000000000000000003e8';

/** increaseAllowance(0x1111...1111, MAX_UINT256) */
const INCREASE_ALLOWANCE_MAX =
	'0x395093510000000000000000000000001111111111111111111111111111111111111111ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

/** increaseAllowance(0x1111...1111, 500) */
const INCREASE_ALLOWANCE_SMALL =
	'0x39509351000000000000000000000000111111111111111111111111111111111111111100000000000000000000000000000000000000000000000000000000000001f4';

/** Permit2 approve(token, spender, MAX_UINT160, expiration) */
const PERMIT2_APPROVE_MAX =
	'0x87517c4500000000000000000000000022222222222222222222222222222222222222220000000000000000000000001111111111111111111111111111111111111111000000000000000000000000ffffffffffffffffffffffffffffffffffffffff00000000000000000000000000000000000000000000000000000002540be3ff';

/** Permit2 approve(token, spender, 1000, expiration) */
const PERMIT2_APPROVE_SMALL =
	'0x87517c450000000000000000000000002222222222222222222222222222222222222222000000000000000000000000111111111111111111111111111111111111111100000000000000000000000000000000000000000000000000000000000003e800000000000000000000000000000000000000000000000000000002540be3ff';

/** setApprovalForAll(0x3333...3333, true) */
const SET_APPROVAL_FOR_ALL_TRUE =
	'0xa22cb46500000000000000000000000033333333333333333333333333333333333333330000000000000000000000000000000000000000000000000000000000000001';

/** setApprovalForAll(0x3333...3333, false) */
const SET_APPROVAL_FOR_ALL_FALSE =
	'0xa22cb46500000000000000000000000033333333333333333333333333333333333333330000000000000000000000000000000000000000000000000000000000000000';

/** ERC-20 transfer(to, amount) — not an approval */
const TRANSFER_CALL =
	'0xa9059cbb000000000000000000000000444444444444444444444444444444444444444400000000000000000000000000000000000000000000000000000000000003e8';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeContext(overrides?: Partial<PolicyContext>): PolicyContext {
	return {
		signerAddress: '0x1234567890abcdef1234567890abcdef12345678',
		toAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		valueWei: 100000000000000000n,
		functionSelector: '0xa9059cbb',
		chainId: 1,
		rollingDailySpendWei: 200000000000000000n,
		rollingMonthlySpendWei: 1000000000000000000n,
		requestCountLastHour: 5,
		requestCountToday: 20,
		currentHourUtc: 14,
		timestamp: new Date(),
		...overrides,
	};
}

const ENABLED = { type: 'blockInfiniteApprovals' as const, enabled: true };
const DISABLED = { type: 'blockInfiniteApprovals' as const, enabled: false };
const evaluate = blockInfiniteApprovalsEvaluator.evaluate.bind(blockInfiniteApprovalsEvaluator);

// ─── blockInfiniteApprovals: ERC-20 approve() ───────────────────────────────

describe('blockInfiniteApprovals — ERC-20 approve()', () => {
	it('blocks MAX_UINT256 approve', () => {
		expect(evaluate(ENABLED, makeContext({ txData: APPROVE_MAX }))).toBe(false);
	});

	it('allows small approve', () => {
		expect(evaluate(ENABLED, makeContext({ txData: APPROVE_SMALL }))).toBe(true);
	});

	it('passes when disabled', () => {
		expect(evaluate(DISABLED, makeContext({ txData: APPROVE_MAX }))).toBe(true);
	});

	it('passes when no txData', () => {
		expect(evaluate(ENABLED, makeContext({ txData: undefined }))).toBe(true);
	});
});

// ─── blockInfiniteApprovals: increaseAllowance() ────────────────────────────

describe('blockInfiniteApprovals — increaseAllowance()', () => {
	it('blocks MAX_UINT256 increaseAllowance', () => {
		expect(evaluate(ENABLED, makeContext({ txData: INCREASE_ALLOWANCE_MAX }))).toBe(false);
	});

	it('allows small increaseAllowance', () => {
		expect(evaluate(ENABLED, makeContext({ txData: INCREASE_ALLOWANCE_SMALL }))).toBe(true);
	});
});

// ─── blockInfiniteApprovals: Permit2 approve() ─────────────────────────────

describe('blockInfiniteApprovals — Permit2 approve()', () => {
	it('blocks MAX_UINT160 Permit2 approve', () => {
		expect(evaluate(ENABLED, makeContext({ txData: PERMIT2_APPROVE_MAX }))).toBe(false);
	});

	it('allows small Permit2 approve', () => {
		expect(evaluate(ENABLED, makeContext({ txData: PERMIT2_APPROVE_SMALL }))).toBe(true);
	});
});

// ─── blockInfiniteApprovals: setApprovalForAll() ────────────────────────────

describe('blockInfiniteApprovals — setApprovalForAll()', () => {
	it('blocks setApprovalForAll(operator, true)', () => {
		expect(evaluate(ENABLED, makeContext({ txData: SET_APPROVAL_FOR_ALL_TRUE }))).toBe(false);
	});

	it('allows setApprovalForAll(operator, false) (revoking)', () => {
		expect(evaluate(ENABLED, makeContext({ txData: SET_APPROVAL_FOR_ALL_FALSE }))).toBe(true);
	});
});

// ─── blockInfiniteApprovals: non-approval calls pass ────────────────────────

describe('blockInfiniteApprovals — non-approval calls', () => {
	it('passes for ERC-20 transfer()', () => {
		expect(evaluate(ENABLED, makeContext({ txData: TRANSFER_CALL }))).toBe(true);
	});

	it('passes for plain ETH transfer (no data)', () => {
		expect(evaluate(ENABLED, makeContext({ txData: '0x' }))).toBe(true);
	});

	it('passes for unknown selector', () => {
		expect(
			evaluate(
				ENABLED,
				makeContext({
					txData: '0xdeadbeef0000000000000000000000000000000000000000000000000000000000000000',
				}),
			),
		).toBe(true);
	});
});

// ─── blockInfiniteApprovals via dispatcher ──────────────────────────────────

describe('evaluateCriterion dispatches blockInfiniteApprovals', () => {
	it('blocks MAX approve through dispatcher', () => {
		expect(
			evaluateCriterion(
				{ type: 'blockInfiniteApprovals', enabled: true },
				makeContext({ txData: APPROVE_MAX }),
			),
		).toBe(false);
	});

	it('blocks Permit2 MAX through dispatcher', () => {
		expect(
			evaluateCriterion(
				{ type: 'blockInfiniteApprovals', enabled: true },
				makeContext({ txData: PERMIT2_APPROVE_MAX }),
			),
		).toBe(false);
	});

	it('blocks setApprovalForAll(true) through dispatcher', () => {
		expect(
			evaluateCriterion(
				{ type: 'blockInfiniteApprovals', enabled: true },
				makeContext({ txData: SET_APPROVAL_FOR_ALL_TRUE }),
			),
		).toBe(false);
	});
});

// ─── USD Limits ──────────────────────────────────────────────────────────────

describe('evaluateMaxPerTxUsd', () => {
	const evalUsd = maxPerTxUsdEvaluator.evaluate.bind(maxPerTxUsdEvaluator);

	it('passes when valueUsd <= maxUsd', () => {
		expect(evalUsd({ type: 'maxPerTxUsd', maxUsd: 100 }, makeContext({ valueUsd: 50 }))).toBe(true);
	});

	it('passes at exact limit', () => {
		expect(evalUsd({ type: 'maxPerTxUsd', maxUsd: 100 }, makeContext({ valueUsd: 100 }))).toBe(
			true,
		);
	});

	it('fails when over limit', () => {
		expect(evalUsd({ type: 'maxPerTxUsd', maxUsd: 100 }, makeContext({ valueUsd: 101 }))).toBe(
			false,
		);
	});

	it('fails when no price data (fail-closed)', () => {
		expect(
			evalUsd({ type: 'maxPerTxUsd', maxUsd: 100 }, makeContext({ valueUsd: undefined })),
		).toBe(false);
	});
});

describe('evaluateDailyLimitUsd', () => {
	const evalUsd = dailyLimitUsdEvaluator.evaluate.bind(dailyLimitUsdEvaluator);

	it('passes when rolling + current <= limit', () => {
		expect(
			evalUsd(
				{ type: 'dailyLimitUsd', maxUsd: 1000 },
				makeContext({ rollingDailySpendUsd: 500, valueUsd: 200 }),
			),
		).toBe(true);
	});

	it('fails when rolling + current > limit', () => {
		expect(
			evalUsd(
				{ type: 'dailyLimitUsd', maxUsd: 1000 },
				makeContext({ rollingDailySpendUsd: 900, valueUsd: 200 }),
			),
		).toBe(false);
	});

	it('fails when valueUsd is undefined (fail-closed)', () => {
		expect(
			evalUsd(
				{ type: 'dailyLimitUsd', maxUsd: 1000 },
				makeContext({ rollingDailySpendUsd: 500, valueUsd: undefined }),
			),
		).toBe(false);
	});

	it('fails when rollingDailySpendUsd is undefined (fail-closed)', () => {
		expect(
			evalUsd(
				{ type: 'dailyLimitUsd', maxUsd: 1000 },
				makeContext({ rollingDailySpendUsd: undefined, valueUsd: 100 }),
			),
		).toBe(false);
	});
});

describe('evaluateMonthlyLimitUsd', () => {
	const evalUsd = monthlyLimitUsdEvaluator.evaluate.bind(monthlyLimitUsdEvaluator);

	it('passes when under limit', () => {
		expect(
			evalUsd(
				{ type: 'monthlyLimitUsd', maxUsd: 5000 },
				makeContext({ rollingMonthlySpendUsd: 2000, valueUsd: 500 }),
			),
		).toBe(true);
	});

	it('fails when over limit', () => {
		expect(
			evalUsd(
				{ type: 'monthlyLimitUsd', maxUsd: 5000 },
				makeContext({ rollingMonthlySpendUsd: 4800, valueUsd: 500 }),
			),
		).toBe(false);
	});
});

// ─── maxSlippage ─────────────────────────────────────────────────────────────

/** swapExactTokensForTokens(amountIn=1000, amountOutMin=0, ...) — zero slippage */
const SWAP_ZERO_SLIPPAGE =
	'0x38ed173900000000000000000000000000000000000000000000000000000000000003e80000000000000000000000000000000000000000000000000000000000000000';

/** swapExactTokensForTokens(amountIn=1000, amountOutMin=900, ...) — normal slippage */
const SWAP_NORMAL_SLIPPAGE =
	'0x38ed173900000000000000000000000000000000000000000000000000000000000003e80000000000000000000000000000000000000000000000000000000000000384';

/** swapExactETHForTokens(amountOutMin=0, ...) — zero slippage on ETH swap */
const SWAP_ETH_ZERO_SLIPPAGE =
	'0x7ff36ab50000000000000000000000000000000000000000000000000000000000000000';

/** swapExactETHForTokens(amountOutMin=500, ...) — normal ETH swap */
const SWAP_ETH_NORMAL =
	'0x7ff36ab500000000000000000000000000000000000000000000000000000000000001f4';

describe('evaluateMaxSlippage', () => {
	const evalSlippage = maxSlippageEvaluator.evaluate.bind(maxSlippageEvaluator);

	it('passes for non-swap transactions', () => {
		expect(
			evalSlippage({ type: 'maxSlippage', maxPercent: 2 }, makeContext({ txData: TRANSFER_CALL })),
		).toBe(true);
	});

	it('passes for plain ETH transfer (no data)', () => {
		expect(
			evalSlippage({ type: 'maxSlippage', maxPercent: 2 }, makeContext({ txData: undefined })),
		).toBe(true);
	});

	it('blocks swapExactTokensForTokens with amountOutMin=0', () => {
		expect(
			evalSlippage(
				{ type: 'maxSlippage', maxPercent: 2 },
				makeContext({ txData: SWAP_ZERO_SLIPPAGE }),
			),
		).toBe(false);
	});

	it('passes swapExactTokensForTokens within maxPercent', () => {
		// amountIn=1000, amountOutMin=900 → 10% slippage. maxPercent=15 → passes.
		expect(
			evalSlippage(
				{ type: 'maxSlippage', maxPercent: 15 },
				makeContext({ txData: SWAP_NORMAL_SLIPPAGE }),
			),
		).toBe(true);
	});

	it('blocks swapExactTokensForTokens exceeding maxPercent', () => {
		// amountIn=1000, amountOutMin=900 → 10% slippage. maxPercent=5 → blocks.
		expect(
			evalSlippage(
				{ type: 'maxSlippage', maxPercent: 5 },
				makeContext({ txData: SWAP_NORMAL_SLIPPAGE }),
			),
		).toBe(false);
	});

	it('blocks swapExactETHForTokens with amountOutMin=0', () => {
		expect(
			evalSlippage(
				{ type: 'maxSlippage', maxPercent: 2 },
				makeContext({ txData: SWAP_ETH_ZERO_SLIPPAGE }),
			),
		).toBe(false);
	});

	it('passes swapExactETHForTokens with non-zero amountOutMin', () => {
		expect(
			evalSlippage(
				{ type: 'maxSlippage', maxPercent: 2 },
				makeContext({ txData: SWAP_ETH_NORMAL }),
			),
		).toBe(true);
	});
});

// ─── mevProtection ───────────────────────────────────────────────────────────

describe('evaluateMevProtection', () => {
	const evalMev = mevProtectionEvaluator.evaluate.bind(mevProtectionEvaluator);

	it('passes when disabled', () => {
		expect(
			evalMev(
				{ type: 'mevProtection', enabled: false },
				makeContext({ txData: SWAP_NORMAL_SLIPPAGE }),
			),
		).toBe(true);
	});

	it('passes for non-swap transactions', () => {
		expect(
			evalMev({ type: 'mevProtection', enabled: true }, makeContext({ txData: TRANSFER_CALL })),
		).toBe(true);
	});

	it('passes for plain ETH transfers', () => {
		expect(
			evalMev({ type: 'mevProtection', enabled: true }, makeContext({ txData: undefined })),
		).toBe(true);
	});

	it('blocks swap transactions when enabled (swapExactTokensForTokens)', () => {
		expect(
			evalMev(
				{ type: 'mevProtection', enabled: true },
				makeContext({ txData: SWAP_NORMAL_SLIPPAGE }),
			),
		).toBe(false);
	});

	it('blocks swap transactions when enabled (swapExactETHForTokens)', () => {
		expect(
			evalMev({ type: 'mevProtection', enabled: true }, makeContext({ txData: SWAP_ETH_NORMAL })),
		).toBe(false);
	});
});

// ─── buildRules → RulesEngine Integration ────────────────────────────────────
//
// This is the critical test: does the FULL path from buildRules() output
// through the rules engine actually block what it should and allow what it should?

describe('buildRules → RulesEngine integration (blocked addresses)', () => {
	const engine = new RulesEngineProvider();

	// Simulate what buildRules() produces for a policy with:
	// - ethValue <= 1 ETH
	// - evmAddressBlocked: [0xBAD...]
	// - blockInfiniteApprovals: enabled
	//
	// After the fix, buildRules() puts ALL criteria in one accept rule.
	const BLOCKED_ADDR = '0xbadbadbadbadbadbadbadbadbadbadbadbadbad0';

	const docWithBlockedAddresses: PolicyDocument = {
		id: 'test-doc',
		signerId: 'test-signer',
		version: 1,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		rules: [
			{
				action: 'accept',
				criteria: [
					{ type: 'ethValue', operator: '<=', value: '1000000000000000000' },
					{ type: 'evmAddress', operator: 'not_in', addresses: [BLOCKED_ADDR] },
					{ type: 'blockInfiniteApprovals', enabled: true },
				],
			},
		],
	};

	it('allows normal tx to non-blocked address', async () => {
		const result = await engine.evaluate(
			docWithBlockedAddresses,
			makeContext({
				toAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
				valueWei: 100000000000000000n,
				txData: TRANSFER_CALL,
			}),
		);
		expect(result.allowed).toBe(true);
	});

	it('BLOCKS tx to blocked address', async () => {
		const result = await engine.evaluate(
			docWithBlockedAddresses,
			makeContext({
				toAddress: BLOCKED_ADDR,
				valueWei: 100000000000000000n,
				txData: TRANSFER_CALL,
			}),
		);
		expect(result.allowed).toBe(false);
		expect(result.violations[0]?.type).toBe(PolicyType.DEFAULT_DENY);
	});

	it('BLOCKS infinite ERC-20 approve even to non-blocked address', async () => {
		const result = await engine.evaluate(
			docWithBlockedAddresses,
			makeContext({
				toAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
				valueWei: 0n,
				txData: APPROVE_MAX,
			}),
		);
		expect(result.allowed).toBe(false);
	});

	it('allows finite ERC-20 approve to non-blocked address', async () => {
		const result = await engine.evaluate(
			docWithBlockedAddresses,
			makeContext({
				toAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
				valueWei: 0n,
				txData: APPROVE_SMALL,
			}),
		);
		expect(result.allowed).toBe(true);
	});

	it('BLOCKS Permit2 MAX approve', async () => {
		const result = await engine.evaluate(
			docWithBlockedAddresses,
			makeContext({
				toAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
				valueWei: 0n,
				txData: PERMIT2_APPROVE_MAX,
			}),
		);
		expect(result.allowed).toBe(false);
	});

	it('BLOCKS setApprovalForAll(true)', async () => {
		const result = await engine.evaluate(
			docWithBlockedAddresses,
			makeContext({
				toAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
				valueWei: 0n,
				txData: SET_APPROVAL_FOR_ALL_TRUE,
			}),
		);
		expect(result.allowed).toBe(false);
	});

	it('allows setApprovalForAll(false) (revocation)', async () => {
		const result = await engine.evaluate(
			docWithBlockedAddresses,
			makeContext({
				toAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
				valueWei: 0n,
				txData: SET_APPROVAL_FOR_ALL_FALSE,
			}),
		);
		expect(result.allowed).toBe(true);
	});

	it('BLOCKS tx over value limit even to non-blocked address', async () => {
		const result = await engine.evaluate(
			docWithBlockedAddresses,
			makeContext({
				toAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
				valueWei: 2000000000000000000n,
				txData: TRANSFER_CALL,
			}),
		);
		expect(result.allowed).toBe(false);
	});
});

// ─── Regression: OLD buggy buildRules would invert blocked addresses ─────────

describe('regression: reject rule with not_in inverts logic', () => {
	const engine = new RulesEngineProvider();
	const BLOCKED_ADDR = '0xbadbadbadbadbadbadbadbadbadbadbadbadbad0';

	// This is the OLD (buggy) structure that buildRules used to produce:
	// reject rule with evmAddress/not_in → accept rule with other criteria
	const buggyDoc: PolicyDocument = {
		id: 'buggy-doc',
		signerId: 'test-signer',
		version: 1,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		rules: [
			{
				action: 'reject',
				criteria: [{ type: 'evmAddress', operator: 'not_in', addresses: [BLOCKED_ADDR] }],
			},
			{
				action: 'accept',
				criteria: [{ type: 'ethValue', operator: '<=', value: '1000000000000000000' }],
			},
		],
	};

	it('OLD structure: sending to blocked address is INCORRECTLY allowed', async () => {
		const result = await engine.evaluate(
			buggyDoc,
			makeContext({ toAddress: BLOCKED_ADDR, valueWei: 100000000000000000n }),
		);
		// The reject rule's not_in criterion returns false for blocked addr → rule doesn't fire
		// Falls through to accept rule → ALLOWED (this is the bug)
		expect(result.allowed).toBe(true); // documenting the bug
	});

	it('OLD structure: sending to safe address is INCORRECTLY rejected', async () => {
		const result = await engine.evaluate(
			buggyDoc,
			makeContext({
				toAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
				valueWei: 100000000000000000n,
			}),
		);
		// The reject rule's not_in criterion returns true for non-blocked addr → rule fires → REJECTED
		expect(result.allowed).toBe(false); // documenting the bug
		expect(result.violations[0]?.type).toBe(PolicyType.RULE_REJECT);
	});
});
