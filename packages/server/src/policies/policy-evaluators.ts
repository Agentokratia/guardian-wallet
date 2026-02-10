import type { PolicyContext } from '@agentokratia/guardian-core';

function safeBigInt(value: string): bigint {
	// Reject anything that isn't a valid integer string (digits, optional leading minus)
	if (!/^-?\d+$/.test(value)) {
		throw new RangeError(`Invalid BigInt value: ${value}`);
	}
	return BigInt(value);
}

export function evaluateSpendingLimit(
	config: Record<string, unknown>,
	context: PolicyContext,
): boolean {
	if (typeof config.maxWei !== 'string') return false;
	const maxWei = safeBigInt(config.maxWei);
	return context.valueWei <= maxWei;
}

export function evaluateDailyLimit(
	config: Record<string, unknown>,
	context: PolicyContext,
): boolean {
	if (typeof config.maxWei !== 'string') return false;
	const maxWei = safeBigInt(config.maxWei);
	return context.rollingDailySpendWei + context.valueWei <= maxWei;
}

export function evaluateMonthlyLimit(
	config: Record<string, unknown>,
	context: PolicyContext,
): boolean {
	if (typeof config.maxWei !== 'string') return false;
	const maxWei = safeBigInt(config.maxWei);
	return context.rollingMonthlySpendWei + context.valueWei <= maxWei;
}

export function evaluateAllowedContracts(
	config: Record<string, unknown>,
	context: PolicyContext,
): boolean {
	if (!Array.isArray(config.addresses)) return false;
	const addresses = (config.addresses as string[]).map((a) => a.toLowerCase());
	const allowDeploy = config.allowDeploy as boolean | undefined;

	if (!context.toAddress) {
		return allowDeploy === true;
	}

	return addresses.includes(context.toAddress.toLowerCase());
}

export function evaluateAllowedFunctions(
	config: Record<string, unknown>,
	context: PolicyContext,
): boolean {
	if (!Array.isArray(config.selectors)) return false;
	const selectors = (config.selectors as string[]).map((s) => s.toLowerCase());

	// Plain ETH transfer (no function selector) is always allowed
	if (!context.functionSelector) {
		return true;
	}

	return selectors.includes(context.functionSelector.toLowerCase());
}

export function evaluateBlockedAddresses(
	config: Record<string, unknown>,
	context: PolicyContext,
): boolean {
	if (!Array.isArray(config.addresses)) return false;
	const addresses = (config.addresses as string[]).map((a) => a.toLowerCase());

	if (!context.toAddress) {
		return true;
	}

	return !addresses.includes(context.toAddress.toLowerCase());
}

export function evaluateRateLimit(
	config: Record<string, unknown>,
	context: PolicyContext,
): boolean {
	if (typeof config.maxPerHour !== 'number') return false;
	return context.requestCountLastHour < config.maxPerHour;
}

export function evaluateTimeWindow(
	config: Record<string, unknown>,
	context: PolicyContext,
): boolean {
	if (typeof config.startHour !== 'number' || typeof config.endHour !== 'number') return false;
	const { startHour, endHour } = config as { startHour: number; endHour: number };
	const hour = context.currentHourUtc;

	if (startHour <= endHour) {
		return hour >= startHour && hour < endHour;
	}
	// Overnight range: e.g. 22-6
	return hour >= startHour || hour < endHour;
}
