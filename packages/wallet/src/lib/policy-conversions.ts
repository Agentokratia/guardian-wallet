/**
 * Policy conversion utilities for the CLI.
 * Mirrors the app's policy-builder/conversions.ts but for CLI use.
 */

import { CRITERION_CATALOG } from '@agentokratia/guardian-core';
import type { CriterionMeta } from '@agentokratia/guardian-core';

export type FormValues = Record<string, Record<string, unknown>>;
export type EnabledMap = Record<string, boolean>;

/**
 * Convert form state → PolicyRule[] for the API.
 * Reject rules first, then one accept rule with all AND'd criteria.
 */
export function buildRules(values: FormValues, enabled: EnabledMap): Record<string, unknown>[] {
	const rules: Record<string, unknown>[] = [];
	const rejectCriteria: Record<string, unknown>[] = [];
	const acceptCriteria: Record<string, unknown>[] = [];

	for (const meta of CRITERION_CATALOG) {
		if (meta.alwaysOn) continue;
		if (!enabled[meta.type]) continue;

		const fieldValues = values[meta.type] ?? {};
		const criterion = meta.toCriterion(fieldValues);

		if (meta.type === 'evmAddressBlocked' || meta.type === 'blockInfiniteApprovals') {
			rejectCriteria.push(criterion);
		} else {
			acceptCriteria.push(criterion);
		}
	}

	for (const c of rejectCriteria) {
		rules.push({ action: 'reject', criteria: [c] });
	}

	if (acceptCriteria.length > 0) {
		rules.push({ action: 'accept', criteria: acceptCriteria });
	}

	return rules;
}

/**
 * Parse a PolicyRule[] back to form state.
 */
export function parseFormValues(rules: Record<string, unknown>[]): {
	values: FormValues;
	enabled: EnabledMap;
} {
	const values: FormValues = {};
	const enabled: EnabledMap = {};

	const metaByType = new Map<string, CriterionMeta>();
	for (const meta of CRITERION_CATALOG) {
		metaByType.set(meta.type, meta);
	}

	for (const rule of rules) {
		const criteria = (rule as { criteria?: Record<string, unknown>[] }).criteria ?? [];
		for (const criterion of criteria) {
			const type = criterion.type as string;
			if (!type) continue;

			const resolvedType =
				type === 'evmAddress' && criterion.operator === 'not_in' ? 'evmAddressBlocked' : type;

			const meta = metaByType.get(resolvedType);
			if (!meta) continue;

			enabled[resolvedType] = true;
			values[resolvedType] = meta.fromCriterion(criterion);
		}
	}

	return { values, enabled };
}
