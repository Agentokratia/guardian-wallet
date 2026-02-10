/**
 * Criteria evaluators — one pure function per criterion type.
 * Each evaluator returns true if the criterion is satisfied.
 * Fail-closed: any error or unexpected input → false.
 */

import { isIP } from 'node:net';
import type {
	Criterion,
	DailyLimitCriterion,
	EthValueCriterion,
	EvmAddressCriterion,
	EvmFunctionCriterion,
	EvmNetworkCriterion,
	IpAddressCriterion,
	MonthlyLimitCriterion,
	PolicyContext,
	RateLimitCriterion,
	TimeWindowCriterion,
} from '@agentokratia/guardian-core';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeBigInt(value: string): bigint {
	if (!/^-?\d+$/.test(value)) {
		throw new RangeError(`Invalid BigInt value: ${value}`);
	}
	return BigInt(value);
}

function compareValues(a: bigint, op: string, b: bigint): boolean {
	switch (op) {
		case '<=': return a <= b;
		case '<': return a < b;
		case '>=': return a >= b;
		case '>': return a > b;
		case '=': return a === b;
		default: return false;
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
	if (!ctx.callerIp) return false;

	const found = c.ips.some((pattern) => ipMatches(ctx.callerIp!, pattern));
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

// ─── Dispatcher ──────────────────────────────────────────────────────────────

/**
 * Evaluate a single criterion against the policy context.
 * Returns true if the criterion is satisfied.
 * Fail-closed: errors → false.
 */
export function evaluateCriterion(criterion: Criterion, ctx: PolicyContext): boolean {
	try {
		switch (criterion.type) {
			case 'ethValue': return evaluateEthValue(criterion, ctx);
			case 'evmAddress': return evaluateEvmAddress(criterion, ctx);
			case 'evmNetwork': return evaluateEvmNetwork(criterion, ctx);
			case 'evmFunction': return evaluateEvmFunction(criterion, ctx);
			case 'ipAddress': return evaluateIpAddress(criterion, ctx);
			case 'rateLimit': return evaluateRateLimit(criterion, ctx);
			case 'timeWindow': return evaluateTimeWindow(criterion, ctx);
			case 'dailyLimit': return evaluateDailyLimit(criterion, ctx);
			case 'monthlyLimit': return evaluateMonthlyLimit(criterion, ctx);
			default: return false;
		}
	} catch {
		// Fail closed: any evaluation error → criterion not met
		return false;
	}
}
