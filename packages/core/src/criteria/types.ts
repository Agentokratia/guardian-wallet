/** Criterion catalog types — metadata for the visual policy builder. */

export type FieldType =
	| 'eth'
	| 'number'
	| 'percent'
	| 'toggle'
	| 'usd'
	| 'addresses'
	| 'selectors'
	| 'chains'
	| 'ips'
	| 'hours';

export interface FieldMeta {
	readonly key: string;
	readonly label: string;
	readonly type: FieldType;
	readonly unit?: string;
	readonly placeholder?: string;
	readonly required?: boolean;
	readonly min?: number;
	readonly max?: number;
}

export type CriterionCategory =
	| 'limits'
	| 'access'
	| 'defi-safety'
	| 'security'
	| 'network'
	| 'advanced';

export interface CriterionMeta {
	/** Matches the `type` field on the Criterion discriminated union. */
	readonly type: string;
	readonly label: string;
	readonly description: string;
	readonly category: CriterionCategory;
	readonly fields: readonly FieldMeta[];
	/** Always enforced server-side, not editable in builder. */
	readonly alwaysOn?: boolean;
	/** Informational only — logged, not blocking. */
	readonly advisory?: boolean;
	/** Convert builder form values → Criterion object. */
	toCriterion: (values: Record<string, unknown>) => Record<string, unknown>;
	/** Convert Criterion object → builder form values. */
	fromCriterion: (criterion: Record<string, unknown>) => Record<string, unknown>;
	/** Validate form values. Returns error message or null. */
	validate: (values: Record<string, unknown>) => string | null;
}
