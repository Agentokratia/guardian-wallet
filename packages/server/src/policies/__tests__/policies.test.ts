import type { PolicyContext } from '@agentokratia/guardian-core';
import { describe, expect, it } from 'vitest';
import {
	evaluateAllowedContracts,
	evaluateAllowedFunctions,
	evaluateBlockedAddresses,
	evaluateDailyLimit,
	evaluateMonthlyLimit,
	evaluateRateLimit,
	evaluateSpendingLimit,
	evaluateTimeWindow,
} from '../policy-evaluators.js';

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
	return {
		signerAddress: '0x1234567890abcdef1234567890abcdef12345678',
		toAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		valueWei: 1000000000000000000n, // 1 ETH
		functionSelector: '0xa9059cbb',
		chainId: 1,
		rollingDailySpendWei: 0n,
		rollingMonthlySpendWei: 0n,
		requestCountLastHour: 0,
		requestCountToday: 0,
		currentHourUtc: 12,
		timestamp: new Date(),
		...overrides,
	};
}

describe('evaluateSpendingLimit', () => {
	it('allows transactions under the limit', () => {
		const result = evaluateSpendingLimit(
			{ maxWei: '2000000000000000000' },
			makeContext({ valueWei: 1000000000000000000n }),
		);
		expect(result).toBe(true);
	});

	it('allows transactions at exact limit', () => {
		const result = evaluateSpendingLimit(
			{ maxWei: '1000000000000000000' },
			makeContext({ valueWei: 1000000000000000000n }),
		);
		expect(result).toBe(true);
	});

	it('blocks transactions over the limit', () => {
		const result = evaluateSpendingLimit(
			{ maxWei: '500000000000000000' },
			makeContext({ valueWei: 1000000000000000000n }),
		);
		expect(result).toBe(false);
	});
});

describe('evaluateDailyLimit', () => {
	it('allows when daily spend plus value is under limit', () => {
		const result = evaluateDailyLimit(
			{ maxWei: '5000000000000000000' },
			makeContext({
				valueWei: 1000000000000000000n,
				rollingDailySpendWei: 2000000000000000000n,
			}),
		);
		expect(result).toBe(true);
	});

	it('blocks when daily spend plus value exceeds limit', () => {
		const result = evaluateDailyLimit(
			{ maxWei: '2000000000000000000' },
			makeContext({
				valueWei: 1000000000000000000n,
				rollingDailySpendWei: 1500000000000000000n,
			}),
		);
		expect(result).toBe(false);
	});
});

describe('evaluateMonthlyLimit', () => {
	it('blocks when monthly spend plus value exceeds limit', () => {
		const result = evaluateMonthlyLimit(
			{ maxWei: '10000000000000000000' },
			makeContext({
				valueWei: 2000000000000000000n,
				rollingMonthlySpendWei: 9000000000000000000n,
			}),
		);
		expect(result).toBe(false);
	});
});

describe('evaluateAllowedContracts', () => {
	it('allows transactions to an allowed address', () => {
		const result = evaluateAllowedContracts(
			{ addresses: ['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], allowDeploy: false },
			makeContext({ toAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
		);
		expect(result).toBe(true);
	});

	it('allows case-insensitive matching', () => {
		const result = evaluateAllowedContracts(
			{ addresses: ['0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'], allowDeploy: false },
			makeContext({ toAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
		);
		expect(result).toBe(true);
	});

	it('blocks transactions to non-allowed addresses', () => {
		const result = evaluateAllowedContracts(
			{ addresses: ['0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'], allowDeploy: false },
			makeContext({ toAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
		);
		expect(result).toBe(false);
	});

	it('blocks deploy when allowDeploy is false', () => {
		const result = evaluateAllowedContracts(
			{ addresses: ['0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'], allowDeploy: false },
			makeContext({ toAddress: undefined }),
		);
		expect(result).toBe(false);
	});

	it('allows deploy when allowDeploy is true', () => {
		const result = evaluateAllowedContracts(
			{ addresses: ['0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'], allowDeploy: true },
			makeContext({ toAddress: undefined }),
		);
		expect(result).toBe(true);
	});
});

describe('evaluateAllowedFunctions', () => {
	it('allows plain ETH transfers (no selector)', () => {
		const result = evaluateAllowedFunctions(
			{ selectors: ['0xa9059cbb'] },
			makeContext({ functionSelector: undefined }),
		);
		expect(result).toBe(true);
	});

	it('allows matching function selectors', () => {
		const result = evaluateAllowedFunctions(
			{ selectors: ['0xa9059cbb', '0x095ea7b3'] },
			makeContext({ functionSelector: '0xa9059cbb' }),
		);
		expect(result).toBe(true);
	});

	it('blocks non-matching function selectors', () => {
		const result = evaluateAllowedFunctions(
			{ selectors: ['0xa9059cbb'] },
			makeContext({ functionSelector: '0xdeadbeef' }),
		);
		expect(result).toBe(false);
	});
});

describe('evaluateBlockedAddresses', () => {
	it('blocks transactions to blocked addresses', () => {
		const result = evaluateBlockedAddresses(
			{ addresses: ['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] },
			makeContext({ toAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
		);
		expect(result).toBe(false);
	});

	it('allows transactions to non-blocked addresses', () => {
		const result = evaluateBlockedAddresses(
			{ addresses: ['0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'] },
			makeContext({ toAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
		);
		expect(result).toBe(true);
	});

	it('allows deploys (no to address)', () => {
		const result = evaluateBlockedAddresses(
			{ addresses: ['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] },
			makeContext({ toAddress: undefined }),
		);
		expect(result).toBe(true);
	});
});

describe('evaluateRateLimit', () => {
	it('allows when under rate limit', () => {
		const result = evaluateRateLimit({ maxPerHour: 10 }, makeContext({ requestCountLastHour: 5 }));
		expect(result).toBe(true);
	});

	it('blocks when at rate limit', () => {
		const result = evaluateRateLimit({ maxPerHour: 10 }, makeContext({ requestCountLastHour: 10 }));
		expect(result).toBe(false);
	});

	it('blocks when over rate limit', () => {
		const result = evaluateRateLimit({ maxPerHour: 10 }, makeContext({ requestCountLastHour: 15 }));
		expect(result).toBe(false);
	});

	it('allows zero requests', () => {
		const result = evaluateRateLimit({ maxPerHour: 10 }, makeContext({ requestCountLastHour: 0 }));
		expect(result).toBe(true);
	});
});

describe('evaluateTimeWindow', () => {
	it('allows within normal window', () => {
		const result = evaluateTimeWindow(
			{ startHour: 9, endHour: 17 },
			makeContext({ currentHourUtc: 12 }),
		);
		expect(result).toBe(true);
	});

	it('blocks outside normal window', () => {
		const result = evaluateTimeWindow(
			{ startHour: 9, endHour: 17 },
			makeContext({ currentHourUtc: 20 }),
		);
		expect(result).toBe(false);
	});

	it('handles overnight window (e.g. 22-6)', () => {
		const result = evaluateTimeWindow(
			{ startHour: 22, endHour: 6 },
			makeContext({ currentHourUtc: 23 }),
		);
		expect(result).toBe(true);
	});

	it('handles overnight window early morning', () => {
		const result = evaluateTimeWindow(
			{ startHour: 22, endHour: 6 },
			makeContext({ currentHourUtc: 3 }),
		);
		expect(result).toBe(true);
	});

	it('blocks during daytime for overnight window', () => {
		const result = evaluateTimeWindow(
			{ startHour: 22, endHour: 6 },
			makeContext({ currentHourUtc: 12 }),
		);
		expect(result).toBe(false);
	});
});
