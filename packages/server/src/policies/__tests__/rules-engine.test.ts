import { type PolicyContext, type PolicyDocument, PolicyType } from '@agentokratia/guardian-core';
import { describe, expect, it } from 'vitest';
import { RulesEngineProvider } from '../rules-engine.provider.js';

function makeContext(overrides?: Partial<PolicyContext>): PolicyContext {
	return {
		signerAddress: '0x1234567890abcdef1234567890abcdef12345678',
		toAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		valueWei: 100000000000000000n, // 0.1 ETH
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

function makeDoc(overrides?: Partial<PolicyDocument>): PolicyDocument {
	return {
		id: 'doc-1',
		signerId: 'signer-1',
		rules: [],
		version: 2,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

describe('RulesEngineProvider', () => {
	const engine = new RulesEngineProvider();

	// ─── Null / Empty ────────────────────────────────────────────────────────

	it('default-denies when document is null', async () => {
		const result = await engine.evaluate(null, makeContext());
		expect(result.allowed).toBe(false);
		expect(result.violations[0]?.type).toBe(PolicyType.DEFAULT_DENY);
	});

	it('default-denies when document has no rules', async () => {
		const result = await engine.evaluate(makeDoc({ rules: [] }), makeContext());
		expect(result.allowed).toBe(false);
		expect(result.violations[0]?.type).toBe(PolicyType.DEFAULT_DENY);
	});

	// ─── First-match-wins ────────────────────────────────────────────────────

	it('accepts on first matching accept rule', async () => {
		const doc = makeDoc({
			rules: [
				{
					action: 'accept',
					description: 'Allow small',
					criteria: [{ type: 'ethValue', operator: '<=', value: '500000000000000000' }],
				},
			],
		});
		const result = await engine.evaluate(doc, makeContext({ valueWei: 100000000000000000n }));
		expect(result.allowed).toBe(true);
		expect(result.violations).toHaveLength(0);
	});

	it('rejects on first matching reject rule', async () => {
		const doc = makeDoc({
			rules: [
				{
					action: 'reject',
					description: 'Block bad address',
					criteria: [
						{
							type: 'evmAddress',
							operator: 'in',
							addresses: ['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
						},
					],
				},
				{
					action: 'accept',
					description: 'Allow everything else',
					criteria: [{ type: 'ethValue', operator: '<=', value: '1000000000000000000' }],
				},
			],
		});
		const result = await engine.evaluate(doc, makeContext());
		expect(result.allowed).toBe(false);
		expect(result.violations[0]?.type).toBe(PolicyType.RULE_REJECT);
		expect(result.violations[0]?.reason).toBe('Block bad address');
	});

	it('skips non-matching rules and evaluates later ones', async () => {
		const doc = makeDoc({
			rules: [
				{
					action: 'reject',
					description: 'Block specific address',
					criteria: [
						{
							type: 'evmAddress',
							operator: 'in',
							addresses: ['0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'],
						},
					],
				},
				{
					action: 'accept',
					description: 'Accept small',
					criteria: [{ type: 'ethValue', operator: '<=', value: '500000000000000000' }],
				},
			],
		});
		const result = await engine.evaluate(doc, makeContext());
		expect(result.allowed).toBe(true);
		expect(result.evaluatedCount).toBe(2);
	});

	// ─── AND logic within a rule ─────────────────────────────────────────────

	it('all criteria must match for rule to fire (AND)', async () => {
		const doc = makeDoc({
			rules: [
				{
					action: 'accept',
					description: 'Requires value AND rate',
					criteria: [
						{ type: 'ethValue', operator: '<=', value: '500000000000000000' },
						{ type: 'rateLimit', maxPerHour: 3 }, // ctx has 5 → fails
					],
				},
			],
		});
		const result = await engine.evaluate(doc, makeContext());
		expect(result.allowed).toBe(false);
		expect(result.violations[0]?.type).toBe(PolicyType.DEFAULT_DENY);
	});

	it('all criteria pass → rule fires', async () => {
		const doc = makeDoc({
			rules: [
				{
					action: 'accept',
					description: 'Both pass',
					criteria: [
						{ type: 'ethValue', operator: '<=', value: '500000000000000000' },
						{ type: 'rateLimit', maxPerHour: 100 },
					],
				},
			],
		});
		const result = await engine.evaluate(doc, makeContext());
		expect(result.allowed).toBe(true);
	});

	// ─── Disabled rules ──────────────────────────────────────────────────────

	it('skips disabled rules', async () => {
		const doc = makeDoc({
			rules: [
				{
					action: 'reject',
					description: 'Disabled reject',
					enabled: false,
					criteria: [
						{
							type: 'evmAddress',
							operator: 'in',
							addresses: ['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
						},
					],
				},
				{
					action: 'accept',
					description: 'Always',
					criteria: [{ type: 'ethValue', operator: '>=', value: '0' }],
				},
			],
		});
		const result = await engine.evaluate(doc, makeContext());
		expect(result.allowed).toBe(true);
		expect(result.evaluatedCount).toBe(1); // only the accept rule
	});

	// ─── Default deny when no rule matches ───────────────────────────────────

	it('default-denies when no rule criteria match', async () => {
		const doc = makeDoc({
			rules: [
				{
					action: 'accept',
					description: 'Only large values',
					criteria: [{ type: 'ethValue', operator: '>=', value: '10000000000000000000' }],
				},
			],
		});
		const result = await engine.evaluate(doc, makeContext());
		expect(result.allowed).toBe(false);
		expect(result.violations[0]?.type).toBe(PolicyType.DEFAULT_DENY);
	});

	// ─── Fail-closed on criterion error ──────────────────────────────────────

	it('criterion error → rule does not match (fail-closed)', async () => {
		const doc = makeDoc({
			rules: [
				{
					action: 'accept',
					description: 'Bad config',
					criteria: [{ type: 'ethValue', operator: '<=', value: 'not-a-number' }],
				},
			],
		});
		const result = await engine.evaluate(doc, makeContext());
		expect(result.allowed).toBe(false);
		expect(result.violations[0]?.type).toBe(PolicyType.DEFAULT_DENY);
	});

	// ─── Complex multi-rule evaluation ───────────────────────────────────────

	it('complex: reject + accept + default deny', async () => {
		const doc = makeDoc({
			rules: [
				{
					action: 'reject',
					description: 'Block known bad',
					criteria: [
						{
							type: 'evmAddress',
							operator: 'in',
							addresses: ['0xdead000000000000000000000000000000000000'],
						},
					],
				},
				{
					action: 'accept',
					description: 'Normal operations',
					criteria: [
						{ type: 'ethValue', operator: '<=', value: '1000000000000000000' },
						{ type: 'dailyLimit', maxWei: '5000000000000000000' },
						{ type: 'rateLimit', maxPerHour: 100 },
					],
				},
			],
		});

		// Normal tx to a good address → accepted
		const result1 = await engine.evaluate(doc, makeContext());
		expect(result1.allowed).toBe(true);

		// Tx to blocked address → rejected
		const result2 = await engine.evaluate(
			doc,
			makeContext({ toAddress: '0xdead000000000000000000000000000000000000' }),
		);
		expect(result2.allowed).toBe(false);
		expect(result2.violations[0]?.type).toBe(PolicyType.RULE_REJECT);

		// Tx with huge value → default deny (reject rule doesn't match, accept rule's ethValue fails)
		const result3 = await engine.evaluate(doc, makeContext({ valueWei: 10000000000000000000n }));
		expect(result3.allowed).toBe(false);
		expect(result3.violations[0]?.type).toBe(PolicyType.DEFAULT_DENY);
	});

	// ─── Timing ──────────────────────────────────────────────────────────────

	it('returns evaluationTimeMs', async () => {
		const doc = makeDoc({
			rules: [
				{
					action: 'accept',
					criteria: [{ type: 'ethValue', operator: '<=', value: '1000000000000000000' }],
				},
			],
		});
		const result = await engine.evaluate(doc, makeContext());
		expect(typeof result.evaluationTimeMs).toBe('number');
		expect(result.evaluationTimeMs).toBeGreaterThanOrEqual(0);
	});
});
