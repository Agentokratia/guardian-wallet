import type { PolicyContext } from '@agentokratia/guardian-core';
import { describe, expect, it } from 'vitest';
import {
	evaluateCriterion,
	evaluateDailyLimit,
	evaluateEthValue,
	evaluateEvmAddress,
	evaluateEvmFunction,
	evaluateEvmNetwork,
	evaluateIpAddress,
	evaluateMonthlyLimit,
	evaluateRateLimit,
	evaluateTimeWindow,
} from '../criteria-evaluators.js';

function makeContext(overrides?: Partial<PolicyContext>): PolicyContext {
	return {
		signerAddress: '0x1234567890abcdef1234567890abcdef12345678',
		toAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		valueWei: 100000000000000000n, // 0.1 ETH
		functionSelector: '0xa9059cbb',
		chainId: 1,
		rollingDailySpendWei: 200000000000000000n, // 0.2 ETH
		rollingMonthlySpendWei: 1000000000000000000n, // 1 ETH
		requestCountLastHour: 5,
		requestCountToday: 20,
		currentHourUtc: 14,
		timestamp: new Date(),
		...overrides,
	};
}

// ─── ethValue ────────────────────────────────────────────────────────────────

describe('evaluateEthValue', () => {
	it('passes when value <= threshold', () => {
		expect(
			evaluateEthValue(
				{ type: 'ethValue', operator: '<=', value: '100000000000000000' },
				makeContext({ valueWei: 100000000000000000n }),
			),
		).toBe(true);
	});

	it('fails when value > threshold', () => {
		expect(
			evaluateEthValue(
				{ type: 'ethValue', operator: '<=', value: '50000000000000000' },
				makeContext({ valueWei: 100000000000000000n }),
			),
		).toBe(false);
	});

	it('handles strict less-than', () => {
		expect(
			evaluateEthValue(
				{ type: 'ethValue', operator: '<', value: '100000000000000000' },
				makeContext({ valueWei: 100000000000000000n }),
			),
		).toBe(false);
	});

	it('handles greater-than-or-equal', () => {
		expect(
			evaluateEthValue(
				{ type: 'ethValue', operator: '>=', value: '50000000000000000' },
				makeContext({ valueWei: 100000000000000000n }),
			),
		).toBe(true);
	});

	it('handles equality', () => {
		expect(
			evaluateEthValue(
				{ type: 'ethValue', operator: '=', value: '100000000000000000' },
				makeContext({ valueWei: 100000000000000000n }),
			),
		).toBe(true);
	});

	it('rejects zero-value transfer with > 0', () => {
		expect(
			evaluateEthValue(
				{ type: 'ethValue', operator: '>', value: '0' },
				makeContext({ valueWei: 0n }),
			),
		).toBe(false);
	});
});

// ─── evmAddress ──────────────────────────────────────────────────────────────

describe('evaluateEvmAddress', () => {
	it('passes when address is in the list (case-insensitive)', () => {
		expect(
			evaluateEvmAddress(
				{
					type: 'evmAddress',
					operator: 'in',
					addresses: ['0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
				},
				makeContext(),
			),
		).toBe(true);
	});

	it('fails when address is NOT in the list', () => {
		expect(
			evaluateEvmAddress(
				{
					type: 'evmAddress',
					operator: 'in',
					addresses: ['0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'],
				},
				makeContext(),
			),
		).toBe(false);
	});

	it('not_in passes when address is NOT in the list', () => {
		expect(
			evaluateEvmAddress(
				{
					type: 'evmAddress',
					operator: 'not_in',
					addresses: ['0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'],
				},
				makeContext(),
			),
		).toBe(true);
	});

	it('handles deploy (no toAddress) with allowDeploy=true', () => {
		expect(
			evaluateEvmAddress(
				{
					type: 'evmAddress',
					operator: 'in',
					addresses: [],
					allowDeploy: true,
				},
				makeContext({ toAddress: undefined }),
			),
		).toBe(true);
	});

	it('blocks deploy (no toAddress) without allowDeploy', () => {
		expect(
			evaluateEvmAddress(
				{
					type: 'evmAddress',
					operator: 'in',
					addresses: [],
				},
				makeContext({ toAddress: undefined }),
			),
		).toBe(false);
	});
});

// ─── evmNetwork ──────────────────────────────────────────────────────────────

describe('evaluateEvmNetwork', () => {
	it('passes when chainId is in the list', () => {
		expect(
			evaluateEvmNetwork(
				{ type: 'evmNetwork', operator: 'in', chainIds: [1, 11155111] },
				makeContext({ chainId: 1 }),
			),
		).toBe(true);
	});

	it('fails when chainId is NOT in the list', () => {
		expect(
			evaluateEvmNetwork(
				{ type: 'evmNetwork', operator: 'in', chainIds: [1] },
				makeContext({ chainId: 42161 }),
			),
		).toBe(false);
	});

	it('not_in passes when chainId is NOT in the list', () => {
		expect(
			evaluateEvmNetwork(
				{ type: 'evmNetwork', operator: 'not_in', chainIds: [1] },
				makeContext({ chainId: 42161 }),
			),
		).toBe(true);
	});
});

// ─── evmFunction ─────────────────────────────────────────────────────────────

describe('evaluateEvmFunction', () => {
	it('passes when selector matches', () => {
		expect(
			evaluateEvmFunction(
				{ type: 'evmFunction', selectors: ['0xa9059cbb'] },
				makeContext({ functionSelector: '0xa9059cbb' }),
			),
		).toBe(true);
	});

	it('fails when selector does NOT match', () => {
		expect(
			evaluateEvmFunction(
				{ type: 'evmFunction', selectors: ['0x12345678'] },
				makeContext({ functionSelector: '0xa9059cbb' }),
			),
		).toBe(false);
	});

	it('allows plain transfer by default', () => {
		expect(
			evaluateEvmFunction(
				{ type: 'evmFunction', selectors: ['0xa9059cbb'] },
				makeContext({ functionSelector: undefined }),
			),
		).toBe(true);
	});

	it('blocks plain transfer when allowPlainTransfer is false', () => {
		expect(
			evaluateEvmFunction(
				{ type: 'evmFunction', selectors: ['0xa9059cbb'], allowPlainTransfer: false },
				makeContext({ functionSelector: undefined }),
			),
		).toBe(false);
	});
});

// ─── ipAddress ───────────────────────────────────────────────────────────────

describe('evaluateIpAddress', () => {
	it('passes when IP is in the list (exact match)', () => {
		expect(
			evaluateIpAddress(
				{ type: 'ipAddress', operator: 'in', ips: ['192.168.1.1'] },
				makeContext({ callerIp: '192.168.1.1' }),
			),
		).toBe(true);
	});

	it('fails when IP is NOT in the list', () => {
		expect(
			evaluateIpAddress(
				{ type: 'ipAddress', operator: 'in', ips: ['192.168.1.1'] },
				makeContext({ callerIp: '10.0.0.1' }),
			),
		).toBe(false);
	});

	it('supports CIDR notation', () => {
		expect(
			evaluateIpAddress(
				{ type: 'ipAddress', operator: 'in', ips: ['10.0.0.0/8'] },
				makeContext({ callerIp: '10.255.255.255' }),
			),
		).toBe(true);
	});

	it('CIDR rejects IPs outside range', () => {
		expect(
			evaluateIpAddress(
				{ type: 'ipAddress', operator: 'in', ips: ['10.0.0.0/8'] },
				makeContext({ callerIp: '11.0.0.1' }),
			),
		).toBe(false);
	});

	it('not_in passes when IP is NOT in range', () => {
		expect(
			evaluateIpAddress(
				{ type: 'ipAddress', operator: 'not_in', ips: ['10.0.0.0/8'] },
				makeContext({ callerIp: '11.0.0.1' }),
			),
		).toBe(true);
	});

	it('fails when callerIp is not provided', () => {
		expect(
			evaluateIpAddress(
				{ type: 'ipAddress', operator: 'in', ips: ['10.0.0.0/8'] },
				makeContext({ callerIp: undefined }),
			),
		).toBe(false);
	});

	it('handles /32 CIDR (single host)', () => {
		expect(
			evaluateIpAddress(
				{ type: 'ipAddress', operator: 'in', ips: ['192.168.1.5/32'] },
				makeContext({ callerIp: '192.168.1.5' }),
			),
		).toBe(true);
	});

	it('handles /0 CIDR (all IPs)', () => {
		expect(
			evaluateIpAddress(
				{ type: 'ipAddress', operator: 'in', ips: ['0.0.0.0/0'] },
				makeContext({ callerIp: '255.255.255.255' }),
			),
		).toBe(true);
	});
});

// ─── rateLimit ───────────────────────────────────────────────────────────────

describe('evaluateRateLimit', () => {
	it('passes when under limit', () => {
		expect(
			evaluateRateLimit(
				{ type: 'rateLimit', maxPerHour: 10 },
				makeContext({ requestCountLastHour: 5 }),
			),
		).toBe(true);
	});

	it('fails when at limit', () => {
		expect(
			evaluateRateLimit(
				{ type: 'rateLimit', maxPerHour: 10 },
				makeContext({ requestCountLastHour: 10 }),
			),
		).toBe(false);
	});

	it('fails when over limit', () => {
		expect(
			evaluateRateLimit(
				{ type: 'rateLimit', maxPerHour: 10 },
				makeContext({ requestCountLastHour: 15 }),
			),
		).toBe(false);
	});
});

// ─── timeWindow ──────────────────────────────────────────────────────────────

describe('evaluateTimeWindow', () => {
	it('passes within window', () => {
		expect(
			evaluateTimeWindow(
				{ type: 'timeWindow', startHour: 9, endHour: 17 },
				makeContext({ currentHourUtc: 12 }),
			),
		).toBe(true);
	});

	it('fails outside window', () => {
		expect(
			evaluateTimeWindow(
				{ type: 'timeWindow', startHour: 9, endHour: 17 },
				makeContext({ currentHourUtc: 20 }),
			),
		).toBe(false);
	});

	it('handles overnight window (22-6)', () => {
		expect(
			evaluateTimeWindow(
				{ type: 'timeWindow', startHour: 22, endHour: 6 },
				makeContext({ currentHourUtc: 23 }),
			),
		).toBe(true);
	});

	it('handles overnight window - early morning', () => {
		expect(
			evaluateTimeWindow(
				{ type: 'timeWindow', startHour: 22, endHour: 6 },
				makeContext({ currentHourUtc: 3 }),
			),
		).toBe(true);
	});

	it('rejects within gap of overnight window', () => {
		expect(
			evaluateTimeWindow(
				{ type: 'timeWindow', startHour: 22, endHour: 6 },
				makeContext({ currentHourUtc: 12 }),
			),
		).toBe(false);
	});
});

// ─── dailyLimit ──────────────────────────────────────────────────────────────

describe('evaluateDailyLimit', () => {
	it('passes when daily spend + value <= limit', () => {
		expect(
			evaluateDailyLimit(
				{ type: 'dailyLimit', maxWei: '500000000000000000' },
				makeContext({ rollingDailySpendWei: 200000000000000000n, valueWei: 100000000000000000n }),
			),
		).toBe(true);
	});

	it('fails when daily spend + value > limit', () => {
		expect(
			evaluateDailyLimit(
				{ type: 'dailyLimit', maxWei: '250000000000000000' },
				makeContext({ rollingDailySpendWei: 200000000000000000n, valueWei: 100000000000000000n }),
			),
		).toBe(false);
	});
});

// ─── monthlyLimit ────────────────────────────────────────────────────────────

describe('evaluateMonthlyLimit', () => {
	it('passes when monthly spend + value <= limit', () => {
		expect(
			evaluateMonthlyLimit(
				{ type: 'monthlyLimit', maxWei: '5000000000000000000' },
				makeContext({
					rollingMonthlySpendWei: 1000000000000000000n,
					valueWei: 100000000000000000n,
				}),
			),
		).toBe(true);
	});

	it('fails when monthly spend + value > limit', () => {
		expect(
			evaluateMonthlyLimit(
				{ type: 'monthlyLimit', maxWei: '1000000000000000000' },
				makeContext({
					rollingMonthlySpendWei: 1000000000000000000n,
					valueWei: 100000000000000000n,
				}),
			),
		).toBe(false);
	});
});

// ─── Dispatcher ──────────────────────────────────────────────────────────────

describe('evaluateCriterion (dispatcher)', () => {
	it('dispatches ethValue', () => {
		expect(
			evaluateCriterion(
				{ type: 'ethValue', operator: '<=', value: '100000000000000000' },
				makeContext(),
			),
		).toBe(true);
	});

	it('returns false for unknown type', () => {
		expect(evaluateCriterion({ type: 'unknownType' } as never, makeContext())).toBe(false);
	});

	it('returns false on evaluation error (fail-closed)', () => {
		expect(
			evaluateCriterion({ type: 'ethValue', operator: '<=', value: 'not-a-number' }, makeContext()),
		).toBe(false);
	});
});
