/**
 * Criterion catalog — the registry of all criterion types.
 *
 * Adding a new criterion:
 * 1. Add interface to `../types/rules.ts` + update Criterion union
 * 2. Add CriterionMeta entry here
 * 3. Create `packages/server/src/policies/evaluators/my-new.evaluator.ts`
 * 4. Add 1 line to EVALUATORS in `evaluators/index.ts` (forget → build fails)
 *
 * Zero UI changes required — the builder reads this catalog dynamically.
 */

import type { CriterionMeta } from './types.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function isValidAddress(addr: string): boolean {
	return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function isValidSelector(sel: string): boolean {
	return /^0x[0-9a-fA-F]{8}$/.test(sel);
}

// ─── Catalog Entries ────────────────────────────────────────────────────────

const ethValue: CriterionMeta = {
	type: 'ethValue',
	label: 'Max transaction value',
	description: 'Cap the ETH value per transaction.',
	category: 'limits',
	fields: [
		{ key: 'operator', label: 'Condition', type: 'number', placeholder: '<=' },
		{ key: 'value', label: 'Max value', type: 'eth', unit: 'wei', required: true, min: 0 },
	],
	toCriterion: (v) => ({
		type: 'ethValue',
		operator: (v.operator as string) || '<=',
		value: String(v.value ?? '0'),
	}),
	fromCriterion: (c) => ({
		operator: c.operator ?? '<=',
		value: c.value ?? '0',
	}),
	validate: (v) => {
		if (v.value === undefined || v.value === '') return 'Enter a max transaction value';
		return null;
	},
};

const evmAddressIn: CriterionMeta = {
	type: 'evmAddress',
	label: 'Approved contracts',
	description: 'Only allow transactions to these addresses.',
	category: 'access',
	fields: [
		{ key: 'addresses', label: 'Addresses', type: 'addresses', required: true },
		{ key: 'allowDeploy', label: 'Allow contract deploys', type: 'toggle' },
	],
	toCriterion: (v) => ({
		type: 'evmAddress',
		operator: 'in',
		addresses: v.addresses ?? [],
		allowDeploy: v.allowDeploy ?? false,
	}),
	fromCriterion: (c) => ({
		addresses: c.addresses ?? [],
		allowDeploy: c.allowDeploy ?? false,
	}),
	validate: (v) => {
		const addrs = v.addresses as string[] | undefined;
		if (!addrs || addrs.length === 0) return null; // empty is allowed (warning shown in UI)
		for (const addr of addrs) {
			if (!isValidAddress(addr)) return `Invalid address: ${addr}`;
		}
		return null;
	},
};

const evmAddressBlocked: CriterionMeta = {
	type: 'evmAddressBlocked',
	label: 'Blocked addresses',
	description: 'Block transactions to these addresses.',
	category: 'access',
	fields: [{ key: 'addresses', label: 'Addresses', type: 'addresses', required: true }],
	toCriterion: (v) => ({
		type: 'evmAddress',
		operator: 'not_in',
		addresses: v.addresses ?? [],
	}),
	fromCriterion: (c) => ({
		addresses: c.addresses ?? [],
	}),
	validate: (v) => {
		const addrs = v.addresses as string[] | undefined;
		if (!addrs || addrs.length === 0) return null;
		for (const addr of addrs) {
			if (!isValidAddress(addr)) return `Invalid address: ${addr}`;
		}
		return null;
	},
};

const evmNetwork: CriterionMeta = {
	type: 'evmNetwork',
	label: 'Allowed chains',
	description: 'Restrict to specific networks.',
	category: 'network',
	fields: [{ key: 'chainIds', label: 'Chains', type: 'chains', required: true }],
	toCriterion: (v) => ({
		type: 'evmNetwork',
		operator: 'in',
		chainIds: v.chainIds ?? [],
	}),
	fromCriterion: (c) => ({
		chainIds: c.chainIds ?? [],
	}),
	validate: (v) => {
		const ids = v.chainIds as number[] | undefined;
		if (!ids || ids.length === 0) return 'Select at least one network';
		return null;
	},
};

const evmFunction: CriterionMeta = {
	type: 'evmFunction',
	label: 'Allowed function calls',
	description: 'Only allow specific contract functions.',
	category: 'advanced',
	fields: [
		{ key: 'selectors', label: 'Function selectors', type: 'selectors', placeholder: '0xa9059cbb' },
		{ key: 'allowPlainTransfer', label: 'Allow plain ETH transfers', type: 'toggle' },
	],
	toCriterion: (v) => ({
		type: 'evmFunction',
		selectors: v.selectors ?? [],
		allowPlainTransfer: v.allowPlainTransfer ?? true,
	}),
	fromCriterion: (c) => ({
		selectors: c.selectors ?? [],
		allowPlainTransfer: c.allowPlainTransfer ?? true,
	}),
	validate: (v) => {
		const sels = v.selectors as string[] | undefined;
		if (!sels || sels.length === 0) return null;
		for (const sel of sels) {
			if (!isValidSelector(sel)) return `Invalid selector: ${sel}`;
		}
		return null;
	},
};

const ipAddress: CriterionMeta = {
	type: 'ipAddress',
	label: 'IP restrictions',
	description: 'Only allow requests from these IPs.',
	category: 'advanced',
	fields: [{ key: 'ips', label: 'IP addresses', type: 'ips', placeholder: '10.0.0.0/8' }],
	toCriterion: (v) => ({
		type: 'ipAddress',
		operator: 'in',
		ips: v.ips ?? [],
	}),
	fromCriterion: (c) => ({
		ips: c.ips ?? [],
	}),
	validate: () => null,
};

const rateLimit: CriterionMeta = {
	type: 'rateLimit',
	label: 'Rate limit',
	description: 'Max signing requests per hour.',
	category: 'limits',
	fields: [{ key: 'maxPerHour', label: 'Max per hour', type: 'number', required: true, min: 1 }],
	toCriterion: (v) => {
		const n = Number(v.maxPerHour);
		if (!n || n <= 0) throw new Error('rateLimit maxPerHour must be a positive number');
		return { type: 'rateLimit', maxPerHour: n };
	},
	fromCriterion: (c) => ({
		maxPerHour: c.maxPerHour ?? 10,
	}),
	validate: (v) => {
		const n = Number(v.maxPerHour);
		if (!n || n <= 0) return 'Enter a rate limit (requests per hour)';
		return null;
	},
};

const timeWindow: CriterionMeta = {
	type: 'timeWindow',
	label: 'Trading hours',
	description: 'Restrict to specific operating hours (UTC).',
	category: 'limits',
	fields: [
		{ key: 'startHour', label: 'From', type: 'hours', required: true, min: 0, max: 23 },
		{ key: 'endHour', label: 'To', type: 'hours', required: true, min: 0, max: 23 },
	],
	toCriterion: (v) => ({
		type: 'timeWindow',
		startHour: Number(v.startHour) || 0,
		endHour: Number(v.endHour) || 23,
	}),
	fromCriterion: (c) => ({
		startHour: c.startHour ?? 0,
		endHour: c.endHour ?? 23,
	}),
	validate: (v) => {
		const s = Number(v.startHour);
		const e = Number(v.endHour);
		if (s < 0 || s > 23) return 'Start hour must be between 0 and 23';
		if (e < 0 || e > 23) return 'End hour must be between 0 and 23';
		if (s === e) return 'Start and end hours must be different';
		return null;
	},
};

const maxPerTxUsd: CriterionMeta = {
	type: 'maxPerTxUsd',
	label: 'Per transaction',
	description: 'Max outgoing value per transaction.',
	category: 'limits',
	fields: [{ key: 'maxUsd', label: 'Max USD', type: 'usd', unit: 'USD', required: true, min: 1 }],
	toCriterion: (v) => ({
		type: 'maxPerTxUsd',
		maxUsd: Number(v.maxUsd) || 0,
	}),
	fromCriterion: (c) => ({
		maxUsd: c.maxUsd ?? 0,
	}),
	validate: (v) => {
		const n = Number(v.maxUsd);
		if (Number.isNaN(n) || n <= 0) return 'Enter a max amount per transaction';
		return null;
	},
};

const dailyLimitUsd: CriterionMeta = {
	type: 'dailyLimitUsd',
	label: 'Daily maximum',
	description: 'Rolling 24-hour spending cap.',
	category: 'limits',
	fields: [
		{ key: 'maxUsd', label: 'Max USD per day', type: 'usd', unit: 'USD', required: true, min: 1 },
	],
	toCriterion: (v) => ({
		type: 'dailyLimitUsd',
		maxUsd: Number(v.maxUsd) || 0,
	}),
	fromCriterion: (c) => ({
		maxUsd: c.maxUsd ?? 0,
	}),
	validate: (v) => {
		const n = Number(v.maxUsd);
		if (Number.isNaN(n) || n <= 0) return 'Enter a daily spending limit';
		return null;
	},
};

const monthlyLimitUsd: CriterionMeta = {
	type: 'monthlyLimitUsd',
	label: 'Monthly maximum',
	description: 'Rolling 30-day spending cap.',
	category: 'limits',
	fields: [
		{ key: 'maxUsd', label: 'Max USD per month', type: 'usd', unit: 'USD', required: true, min: 1 },
	],
	toCriterion: (v) => ({
		type: 'monthlyLimitUsd',
		maxUsd: Number(v.maxUsd) || 0,
	}),
	fromCriterion: (c) => ({
		maxUsd: c.maxUsd ?? 0,
	}),
	validate: (v) => {
		const n = Number(v.maxUsd);
		if (Number.isNaN(n) || n <= 0) return 'Enter a monthly spending limit';
		return null;
	},
};

const blockInfiniteApprovals: CriterionMeta = {
	type: 'blockInfiniteApprovals',
	label: 'Block unlimited token approvals',
	description:
		'Reject unlimited approve(), increaseAllowance(), Permit2, and setApprovalForAll. Prevents contracts from draining your wallet.',
	category: 'defi-safety',
	fields: [{ key: 'enabled', label: 'Enabled', type: 'toggle' }],
	toCriterion: (v) => ({
		type: 'blockInfiniteApprovals',
		enabled: v.enabled !== false,
	}),
	fromCriterion: (c) => ({
		enabled: c.enabled !== false,
	}),
	validate: () => null,
};

const maxSlippage: CriterionMeta = {
	type: 'maxSlippage',
	label: 'Max slippage',
	description: 'Reject swaps where slippage tolerance exceeds your threshold.',
	category: 'defi-safety',
	fields: [
		{
			key: 'maxPercent',
			label: 'Max slippage',
			type: 'percent',
			unit: '%',
			required: true,
			min: 0,
			max: 100,
		},
	],
	toCriterion: (v) => ({
		type: 'maxSlippage',
		maxPercent: Number(v.maxPercent) || 2,
	}),
	fromCriterion: (c) => ({
		maxPercent: c.maxPercent ?? 2,
	}),
	validate: (v) => {
		const n = Number(v.maxPercent);
		if (Number.isNaN(n) || n < 0 || n > 100) return 'Enter a slippage percentage (0–100)';
		return null;
	},
};

const mevProtection: CriterionMeta = {
	type: 'mevProtection',
	label: 'Front-running protection',
	description:
		'Block swap transactions at risk of being front-run by other traders. Prevents sandwich attacks.',
	category: 'defi-safety',
	fields: [{ key: 'enabled', label: 'Enabled', type: 'toggle' }],
	toCriterion: (v) => ({
		type: 'mevProtection',
		enabled: v.enabled !== false,
	}),
	fromCriterion: (c) => ({
		enabled: c.enabled !== false,
	}),
	validate: () => null,
};

const maliciousAddressBlacklist: CriterionMeta = {
	type: 'maliciousAddressBlacklist',
	label: 'Scam address protection',
	description: 'Known malicious and burn addresses blocked automatically.',
	category: 'security',
	alwaysOn: true,
	fields: [],
	toCriterion: () => ({}),
	fromCriterion: () => ({}),
	validate: () => null,
};

// ─── Export ──────────────────────────────────────────────────────────────────

/**
 * All criterion definitions. The builder reads this to render form sections.
 * Order matters — this is the display order in the UI.
 */
export const CRITERION_CATALOG: readonly CriterionMeta[] = [
	// Access
	evmAddressIn,
	evmAddressBlocked,
	// Limits
	maxPerTxUsd,
	dailyLimitUsd,
	monthlyLimitUsd,
	ethValue,
	rateLimit,
	timeWindow,
	// DeFi safety
	blockInfiniteApprovals,
	maxSlippage,
	mevProtection,
	// Security (always-on)
	maliciousAddressBlacklist,
	// Network
	evmNetwork,
	// Advanced
	evmFunction,
	ipAddress,
];
