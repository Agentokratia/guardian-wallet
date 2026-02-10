import { type PolicyContext, PolicyType } from '@agentokratia/guardian-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { PolicyEngineProvider } from '../policy-engine.provider.js';

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
	return {
		signerAddress: '0xabc123',
		toAddress: '0xdef456',
		valueWei: 1000000000000000n, // 0.001 ETH
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

// ---------- PolicyEngineProvider (integration tests) ----------

describe('PolicyEngineProvider', () => {
	let engine: PolicyEngineProvider;

	beforeEach(() => {
		engine = new PolicyEngineProvider();
	});

	it('returns allowed=true when no policies are violated', async () => {
		const result = await engine.evaluate(
			[
				{
					id: 'p1',
					type: PolicyType.SPENDING_LIMIT,
					config: { maxWei: '10000000000000000' },
					enabled: true,
				},
			],
			makeContext({ valueWei: 1000000000000000n }),
		);

		expect(result.allowed).toBe(true);
		expect(result.violations).toHaveLength(0);
		expect(result.evaluatedCount).toBe(1);
	});

	it('returns allowed=false with violations when policy blocks', async () => {
		const result = await engine.evaluate(
			[
				{
					id: 'p1',
					type: PolicyType.SPENDING_LIMIT,
					config: { maxWei: '100' },
					enabled: true,
				},
			],
			makeContext({ valueWei: 1000000000000000n }),
		);

		expect(result.allowed).toBe(false);
		expect(result.violations).toHaveLength(1);
		expect(result.violations[0]?.policyId).toBe('p1');
		expect(result.violations[0]?.type).toBe(PolicyType.SPENDING_LIMIT);
	});

	it('skips disabled policies', async () => {
		const result = await engine.evaluate(
			[
				{
					id: 'p1',
					type: PolicyType.SPENDING_LIMIT,
					config: { maxWei: '100' },
					enabled: false,
				},
			],
			makeContext({ valueWei: 1000000000000000n }),
		);

		expect(result.allowed).toBe(true);
		expect(result.evaluatedCount).toBe(0);
	});

	it('evaluates multiple policies and collects all violations', async () => {
		const result = await engine.evaluate(
			[
				{
					id: 'p1',
					type: PolicyType.SPENDING_LIMIT,
					config: { maxWei: '100' },
					enabled: true,
				},
				{
					id: 'p2',
					type: PolicyType.RATE_LIMIT,
					config: { maxPerHour: 5 },
					enabled: true,
				},
			],
			makeContext({
				valueWei: 1000000000000000n,
				requestCountLastHour: 10,
			}),
		);

		expect(result.allowed).toBe(false);
		expect(result.violations).toHaveLength(2);
		expect(result.evaluatedCount).toBe(2);
	});

	it('returns evaluationTimeMs as a number', async () => {
		const result = await engine.evaluate(
			[
				{
					id: 'p1',
					type: PolicyType.SPENDING_LIMIT,
					config: { maxWei: '10000000000000000' },
					enabled: true,
				},
			],
			makeContext(),
		);

		expect(typeof result.evaluationTimeMs).toBe('number');
		expect(result.evaluationTimeMs).toBeGreaterThanOrEqual(0);
	});
});
