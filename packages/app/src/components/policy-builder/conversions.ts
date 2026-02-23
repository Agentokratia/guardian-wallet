/**
 * Conversions between the visual builder form state and PolicyRule[] documents.
 *
 * The builder state is a flat Record<criterionType, Record<fieldKey, value>>.
 * buildRules() converts it to a PolicyRule[] for the API.
 * parseFormValues() converts a PolicyRule[] back to form state for editing.
 */

import { CRITERION_CATALOG } from '@agentokratia/guardian-core';
import type { CriterionMeta } from '@agentokratia/guardian-core';

export type FormValues = Record<string, Record<string, unknown>>;

/**
 * Which criteria are enabled (toggled on in the builder).
 * Criteria with fields always start disabled until the user enables them.
 * Criteria with `alwaysOn` are always enabled.
 */
export type EnabledMap = Record<string, boolean>;

/**
 * Convert builder form state → PolicyRule[] for the API.
 *
 * Strategy:
 * - One accept rule with ALL criteria AND'd together
 * - Default deny catches everything that doesn't match
 *
 * All evaluators use "true = allow, false = block" semantics.
 * Blocked addresses (evmAddress/not_in) return false when the target IS blocked,
 * so AND'ing them into the accept rule correctly prevents matching → default deny.
 */
export function buildRules(values: FormValues, enabled: EnabledMap): Record<string, unknown>[] {
	const criteria: Record<string, unknown>[] = [];

	for (const meta of CRITERION_CATALOG) {
		if (meta.alwaysOn) continue; // always-on are server-side, not in rules
		if (!enabled[meta.type]) continue;

		const fieldValues = values[meta.type] ?? {};
		criteria.push(meta.toCriterion(fieldValues));
	}

	if (criteria.length === 0) return [];

	return [{ action: 'accept', criteria }];
}

/**
 * Parse a PolicyRule[] back to builder form state.
 * Used when loading an existing policy for editing.
 */
export function parseFormValues(rules: Record<string, unknown>[]): {
	values: FormValues;
	enabled: EnabledMap;
} {
	const values: FormValues = {};
	const enabled: EnabledMap = {};

	// Build a lookup from criterion type → CriterionMeta
	const metaByType = new Map<string, CriterionMeta>();
	for (const meta of CRITERION_CATALOG) {
		metaByType.set(meta.type, meta);
	}

	for (const rule of rules) {
		const criteria = (rule as { criteria?: Record<string, unknown>[] }).criteria ?? [];
		for (const criterion of criteria) {
			const type = criterion.type as string;
			if (!type) continue;

			// evmAddress with operator 'not_in' maps to 'evmAddressBlocked'
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

/**
 * Get the initial form values with defaults for all criteria.
 */
export function getDefaultFormValues(): FormValues {
	const values: FormValues = {};
	for (const meta of CRITERION_CATALOG) {
		if (meta.alwaysOn) continue;
		// Initialize with empty fromCriterion (defaults)
		values[meta.type] = meta.fromCriterion({});
	}
	return values;
}

/**
 * Validate all enabled criteria. Returns a map of type → error message.
 */
export function validateAll(values: FormValues, enabled: EnabledMap): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const meta of CRITERION_CATALOG) {
		if (meta.alwaysOn) continue;
		if (!enabled[meta.type]) continue;
		const err = meta.validate(values[meta.type] ?? {});
		if (err) errors[meta.type] = err;
	}
	return errors;
}
