/**
 * Criteria evaluators — one pure function per criterion type.
 * Each evaluator returns true if the criterion is satisfied.
 * Fail-closed: any error or unexpected input → false.
 */

import { isIP } from 'node:net';
import type {
	BlockInfiniteApprovalsCriterion,
	Criterion,
	DailyLimitCriterion,
	DailyLimitUsdCriterion,
	EthValueCriterion,
	EvmAddressCriterion,
	EvmFunctionCriterion,
	EvmNetworkCriterion,
	IpAddressCriterion,
	MaxPerTxUsdCriterion,
	MaxSlippageCriterion,
	MevProtectionCriterion,
	MonthlyLimitCriterion,
	MonthlyLimitUsdCriterion,
	PolicyContext,
	RateLimitCriterion,
	TimeWindowCriterion,
} from '@agentokratia/guardian-core';
import { type Hex, decodeAbiParameters, isAddress, parseAbiParameters } from 'viem';
import { EFFECTIVELY_UNLIMITED } from '../common/transfer-decoder.service.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeBigInt(value: string): bigint {
	if (!/^-?\d+$/.test(value)) {
		throw new RangeError(`Invalid BigInt value: ${value}`);
	}
	return BigInt(value);
}

function compareValues(a: bigint, op: string, b: bigint): boolean {
	switch (op) {
		case '<=':
			return a <= b;
		case '<':
			return a < b;
		case '>=':
			return a >= b;
		case '>':
			return a > b;
		case '=':
			return a === b;
		default:
			return false;
	}
}

/** Check if an IPv4 address is within a CIDR range. */
function ipInCidr(ip: string, cidr: string): boolean {
	const [range, prefixStr] = cidr.split('/');
	if (!range || !prefixStr) return false;
	const prefix = Number.parseInt(prefixStr, 10);
	if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) return false;

	if (isIP(ip) !== 4 || isIP(range) !== 4) return false;

	const ipNum = ipv4ToNum(ip);
	const rangeNum = ipv4ToNum(range);
	if (ipNum === null || rangeNum === null) return false;
	const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
	return (ipNum & mask) === (rangeNum & mask);
}

function ipv4ToNum(ip: string): number | null {
	const parts = ip.split('.');
	if (parts.length !== 4) return null;
	let num = 0;
	for (const part of parts) {
		const n = Number.parseInt(part, 10);
		if (Number.isNaN(n) || n < 0 || n > 255) return null;
		num = (num << 8) | n;
	}
	return num >>> 0;
}

function ipMatches(ip: string, pattern: string): boolean {
	if (pattern.includes('/')) {
		return ipInCidr(ip, pattern);
	}
	return ip === pattern;
}

// ─── Criterion Evaluators ────────────────────────────────────────────────────

export function evaluateEthValue(c: EthValueCriterion, ctx: PolicyContext): boolean {
	const threshold = safeBigInt(c.value);
	return compareValues(ctx.valueWei, c.operator, threshold);
}

export function evaluateEvmAddress(c: EvmAddressCriterion, ctx: PolicyContext): boolean {
	// Empty allowlist → no address restriction configured → pass
	if (c.operator === 'in' && c.addresses.length === 0) return true;

	// Contract deployment (toAddress is undefined/null)
	if (!ctx.toAddress) {
		if (c.operator === 'in') {
			return c.allowDeploy === true;
		}
		// not_in: deploy is allowed unless explicitly blocked (no address to block)
		return true;
	}

	const lower = ctx.toAddress.toLowerCase();
	const addresses = c.addresses.map((a) => a.toLowerCase());
	const found = addresses.includes(lower);

	return c.operator === 'in' ? found : !found;
}

export function evaluateEvmNetwork(c: EvmNetworkCriterion, ctx: PolicyContext): boolean {
	// Empty allowlist → no network restriction configured → pass
	if (c.operator === 'in' && c.chainIds.length === 0) return true;

	const found = c.chainIds.includes(ctx.chainId);
	return c.operator === 'in' ? found : !found;
}

export function evaluateEvmFunction(c: EvmFunctionCriterion, ctx: PolicyContext): boolean {
	// Plain ETH transfer (no function selector)
	if (!ctx.functionSelector) {
		return c.allowPlainTransfer !== false; // default true
	}
	const lower = ctx.functionSelector.toLowerCase();
	return c.selectors.some((s) => s.toLowerCase() === lower);
}

export function evaluateIpAddress(c: IpAddressCriterion, ctx: PolicyContext): boolean {
	// Empty allowlist → no IP restriction configured → pass
	if (c.operator === 'in' && c.ips.length === 0) return true;

	const ip = ctx.callerIp;
	if (!ip) return false;

	const found = c.ips.some((pattern) => ipMatches(ip, pattern));
	return c.operator === 'in' ? found : !found;
}

export function evaluateRateLimit(c: RateLimitCriterion, ctx: PolicyContext): boolean {
	return ctx.requestCountLastHour < c.maxPerHour;
}

export function evaluateTimeWindow(c: TimeWindowCriterion, ctx: PolicyContext): boolean {
	const hour = ctx.currentHourUtc;
	const { startHour, endHour } = c;

	if (startHour <= endHour) {
		return hour >= startHour && hour < endHour;
	}
	// Overnight range: e.g. 22-6
	return hour >= startHour || hour < endHour;
}

export function evaluateDailyLimit(c: DailyLimitCriterion, ctx: PolicyContext): boolean {
	const maxWei = safeBigInt(c.maxWei);
	return ctx.rollingDailySpendWei + ctx.valueWei <= maxWei;
}

export function evaluateMonthlyLimit(c: MonthlyLimitCriterion, ctx: PolicyContext): boolean {
	const maxWei = safeBigInt(c.maxWei);
	return ctx.rollingMonthlySpendWei + ctx.valueWei <= maxWei;
}

// ─── USD Limit Evaluators ───────────────────────────────────────────────────

export function evaluateMaxPerTxUsd(c: MaxPerTxUsdCriterion, ctx: PolicyContext): boolean {
	if (ctx.valueUsd === undefined) return false; // fail-closed: no price data → block
	return ctx.valueUsd <= c.maxUsd;
}

export function evaluateDailyLimitUsd(c: DailyLimitUsdCriterion, ctx: PolicyContext): boolean {
	if (ctx.valueUsd === undefined || ctx.rollingDailySpendUsd === undefined) return false;
	return ctx.rollingDailySpendUsd + ctx.valueUsd <= c.maxUsd;
}

export function evaluateMonthlyLimitUsd(c: MonthlyLimitUsdCriterion, ctx: PolicyContext): boolean {
	if (ctx.valueUsd === undefined || ctx.rollingMonthlySpendUsd === undefined) return false;
	return ctx.rollingMonthlySpendUsd + ctx.valueUsd <= c.maxUsd;
}

// ─── DeFi Safety Evaluators ─────────────────────────────────────────────────

// ERC-20 approve(address,uint256)          — 0x095ea7b3
// ERC-20 increaseAllowance(address,uint256) — 0x39509351 (OpenZeppelin)
const APPROVE_ABI_PARAMS = parseAbiParameters('address spender, uint256 amount');

// Permit2 approve(address,address,uint160,uint48) — 0x87517c45
const PERMIT2_APPROVE_PARAMS = parseAbiParameters(
	'address token, address spender, uint160 amount, uint48 expiration',
);

// ERC-721/1155 setApprovalForAll(address,bool) — 0xa22cb465
const SET_APPROVAL_FOR_ALL_PARAMS = parseAbiParameters('address operator, bool approved');

/** Selectors that grant token spending rights. */
const APPROVAL_SELECTORS: Record<string, 'erc20' | 'permit2' | 'approvalForAll'> = {
	'0x095ea7b3': 'erc20', // approve(address,uint256)
	'0x39509351': 'erc20', // increaseAllowance(address,uint256)
	'0x87517c45': 'permit2', // Permit2 approve(address,uint160,uint48,uint48)
	'0xa22cb465': 'approvalForAll', // setApprovalForAll(address,bool)
};

export function evaluateBlockInfiniteApprovals(
	c: BlockInfiniteApprovalsCriterion,
	ctx: PolicyContext,
): boolean {
	if (!c.enabled) return true;
	if (!ctx.txData) return true;

	const selector = ctx.txData.slice(0, 10).toLowerCase();
	const approvalType = APPROVAL_SELECTORS[selector];
	if (!approvalType) return true; // not an approval call

	try {
		const params = `0x${ctx.txData.slice(10)}` as Hex;

		if (approvalType === 'erc20') {
			const [, amount] = decodeAbiParameters(APPROVE_ABI_PARAMS, params);
			return amount < EFFECTIVELY_UNLIMITED;
		}

		if (approvalType === 'permit2') {
			// Permit2 uses uint160 for amount — max uint160 is effectively unlimited
			const [, , amount] = decodeAbiParameters(PERMIT2_APPROVE_PARAMS, params);
			const PERMIT2_MAX = (1n << 160n) - 1n;
			return amount < PERMIT2_MAX;
		}

		if (approvalType === 'approvalForAll') {
			// setApprovalForAll(operator, true) grants blanket access — always block
			const [, approved] = decodeAbiParameters(SET_APPROVAL_FOR_ALL_PARAMS, params);
			return !approved; // approved=true → block (return false)
		}

		return true;
	} catch {
		return false; // can't parse approval calldata → fail-closed (block)
	}
}

export function evaluateMaxSlippage(c: MaxSlippageCriterion, _ctx: PolicyContext): boolean {
	// v1: advisory — always passes. Actual slippage analysis requires price oracle integration.
	// The TransferDecoderService.isZeroSlippageSwap() handles the hard zero case.
	// Full slippage percentage check deferred to v2 with price oracle.
	void c;
	return true;
}

export function evaluateMevProtection(c: MevProtectionCriterion, _ctx: PolicyContext): boolean {
	// Advisory — always passes, logged for audit purposes only.
	void c;
	return true;
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

/**
 * Evaluate a single criterion against the policy context.
 * Returns true if the criterion is satisfied.
 * Fail-closed: errors → false.
 */
export function evaluateCriterion(criterion: Criterion, ctx: PolicyContext): boolean {
	try {
		switch (criterion.type) {
			case 'ethValue':
				return evaluateEthValue(criterion, ctx);
			case 'evmAddress':
				return evaluateEvmAddress(criterion, ctx);
			case 'evmNetwork':
				return evaluateEvmNetwork(criterion, ctx);
			case 'evmFunction':
				return evaluateEvmFunction(criterion, ctx);
			case 'ipAddress':
				return evaluateIpAddress(criterion, ctx);
			case 'rateLimit':
				return evaluateRateLimit(criterion, ctx);
			case 'timeWindow':
				return evaluateTimeWindow(criterion, ctx);
			case 'dailyLimit':
				return evaluateDailyLimit(criterion, ctx);
			case 'monthlyLimit':
				return evaluateMonthlyLimit(criterion, ctx);
			case 'maxPerTxUsd':
				return evaluateMaxPerTxUsd(criterion, ctx);
			case 'dailyLimitUsd':
				return evaluateDailyLimitUsd(criterion, ctx);
			case 'monthlyLimitUsd':
				return evaluateMonthlyLimitUsd(criterion, ctx);
			case 'blockInfiniteApprovals':
				return evaluateBlockInfiniteApprovals(criterion, ctx);
			case 'maxSlippage':
				return evaluateMaxSlippage(criterion, ctx);
			case 'mevProtection':
				return evaluateMevProtection(criterion, ctx);
			default:
				return false;
		}
	} catch {
		// Fail closed: any evaluation error → criterion not met
		return false;
	}
}
