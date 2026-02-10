/**
 * Rules editor for signer policy documents.
 * Rules are ordered, first-match-wins, default deny.
 * Each rule has an action (accept/reject) and composable criteria (AND'd).
 */

import { Button } from '@/components/ui/button';
import { Mono } from '@/components/ui/mono';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, Loader2, Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

/** Criteria types shown in the reference panel. */
const CRITERIA_TYPES: {
	type: string;
	label: string;
	description: string;
	schema: string;
}[] = [
	{
		type: 'ethValue',
		label: 'ETH Value',
		description: 'Compare tx value (wei)',
		schema: '{ "type": "ethValue", "operator": "<=", "value": "100000000000000000" }',
	},
	{
		type: 'evmAddress',
		label: 'EVM Address',
		description: 'Match destination address',
		schema: '{ "type": "evmAddress", "operator": "in"|"not_in", "addresses": ["0x..."], "allowDeploy"?: bool }',
	},
	{
		type: 'evmNetwork',
		label: 'EVM Network',
		description: 'Match chain ID',
		schema: '{ "type": "evmNetwork", "operator": "in"|"not_in", "chainIds": [1, 11155111] }',
	},
	{
		type: 'evmFunction',
		label: 'EVM Function',
		description: 'Match function selector',
		schema: '{ "type": "evmFunction", "selectors": ["0xa9059cbb"], "allowPlainTransfer"?: bool }',
	},
	{
		type: 'ipAddress',
		label: 'IP Address',
		description: 'Match caller IP (CIDR ok)',
		schema: '{ "type": "ipAddress", "operator": "in"|"not_in", "ips": ["10.0.0.0/8"] }',
	},
	{
		type: 'rateLimit',
		label: 'Rate Limit',
		description: 'Max requests per hour',
		schema: '{ "type": "rateLimit", "maxPerHour": 10 }',
	},
	{
		type: 'timeWindow',
		label: 'Time Window',
		description: 'Operating hours (UTC)',
		schema: '{ "type": "timeWindow", "startHour": 9, "endHour": 17 }',
	},
	{
		type: 'dailyLimit',
		label: 'Daily Limit',
		description: '24h rolling spend cap',
		schema: '{ "type": "dailyLimit", "maxWei": "500000000000000000" }',
	},
	{
		type: 'monthlyLimit',
		label: 'Monthly Limit',
		description: '30-day rolling spend cap',
		schema: '{ "type": "monthlyLimit", "maxWei": "5000000000000000000" }',
	},
];

interface PolicyRule {
	action: 'accept' | 'reject';
	description?: string;
	criteria: Record<string, unknown>[];
	enabled?: boolean;
}

const PRESET_TEMPLATES: {
	label: string;
	description: string;
	rules: PolicyRule[];
}[] = [
	{
		label: 'Conservative',
		description: 'Block bad addresses, 0.1 ETH/tx, 0.5 ETH/day, 10 req/hr, business hours',
		rules: [
			{
				action: 'reject',
				description: 'Block known bad addresses',
				criteria: [
					{ type: 'evmAddress', operator: 'in', addresses: ['0x...paste-blocked-address'] },
				],
			},
			{
				action: 'accept',
				description: 'Normal operations',
				criteria: [
					{ type: 'ethValue', operator: '<=', value: '100000000000000000' },
					{ type: 'dailyLimit', maxWei: '500000000000000000' },
					{ type: 'rateLimit', maxPerHour: 10 },
					{ type: 'timeWindow', startHour: 9, endHour: 17 },
				],
			},
		],
	},
	{
		label: 'Trading Bot',
		description: '1 ETH/tx, 5 ETH/day, 100 req/hr, 24/7',
		rules: [
			{
				action: 'accept',
				description: 'Trading operations',
				criteria: [
					{ type: 'ethValue', operator: '<=', value: '1000000000000000000' },
					{ type: 'dailyLimit', maxWei: '5000000000000000000' },
					{ type: 'rateLimit', maxPerHour: 100 },
				],
			},
		],
	},
	{
		label: 'Deploy Only',
		description: 'Allow contract deploys, block all value transfers',
		rules: [
			{
				action: 'accept',
				description: 'Contract deployment only',
				criteria: [
					{ type: 'ethValue', operator: '<=', value: '0' },
					{ type: 'evmAddress', operator: 'in', addresses: [], allowDeploy: true },
				],
			},
		],
	},
];

function weiToEth(wei: string): string {
	const n = Number(wei) / 1e18;
	if (n === 0) return '0 ETH';
	if (n < 0.001) return `${n.toExponential(2)} ETH`;
	return `${n} ETH`;
}

/** Parse and validate the JSON rules document. */
function parseRulesDocument(json: string): PolicyRule[] {
	const parsed = JSON.parse(json);
	if (!parsed || !Array.isArray(parsed.rules)) {
		throw new Error('Expected { "rules": [...] }');
	}
	for (const rule of parsed.rules) {
		if (rule.action !== 'accept' && rule.action !== 'reject') {
			throw new Error(`Each rule must have action "accept" or "reject"`);
		}
		if (!Array.isArray(rule.criteria) || rule.criteria.length === 0) {
			throw new Error(`Rule "${rule.description ?? '?'}" must have at least one criterion`);
		}
		for (const c of rule.criteria) {
			if (typeof c.type !== 'string') {
				throw new Error('Each criterion must have a "type" string');
			}
		}
	}
	return parsed.rules;
}

interface PolicyDocEditorProps {
	rules: Record<string, unknown>[];
	onSave: (rules: Record<string, unknown>[]) => void;
	saving?: boolean;
	className?: string;
}

export function PolicyJsonEditor({
	rules,
	onSave,
	saving,
	className,
}: PolicyDocEditorProps) {
	const initialJson = useMemo(() => JSON.stringify({ rules }, null, 2), [rules]);
	const [json, setJson] = useState(initialJson);
	const [error, setError] = useState<string | null>(null);
	const [refOpen, setRefOpen] = useState(false);
	const [templatesOpen, setTemplatesOpen] = useState(() => rules.length === 0);

	useEffect(() => {
		setJson(JSON.stringify({ rules }, null, 2));
		setError(null);
	}, [rules]);

	const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setJson(e.target.value);
		setError(null);
	}, []);

	const applyPreset = useCallback((preset: PolicyRule[]) => {
		setJson(JSON.stringify({ rules: preset }, null, 2));
		setError(null);
		setTemplatesOpen(false);
	}, []);

	const handleSave = useCallback(() => {
		try {
			const parsed = parseRulesDocument(json);
			onSave(parsed as unknown as Record<string, unknown>[]);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : 'Invalid JSON';
			setError(msg);
		}
	}, [json, onSave]);

	const isDirty = json !== initialJson;

	return (
		<div className={cn('space-y-3', className)}>
			{/* Preset templates */}
			{templatesOpen && (
				<div className="rounded-lg border border-border bg-surface p-4 space-y-3">
					<div className="flex items-center justify-between">
						<div>
							<div className="text-sm font-semibold text-text">Quick Start Templates</div>
							<Mono size="xs" className="text-text-dim">Ordered rules — first match wins, default deny</Mono>
						</div>
						<button
							type="button"
							onClick={() => setTemplatesOpen(false)}
							className="text-xs text-text-dim hover:text-text transition-colors"
						>
							Dismiss
						</button>
					</div>
					<div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
						{PRESET_TEMPLATES.map((preset) => (
							<button
								key={preset.label}
								type="button"
								onClick={() => applyPreset(preset.rules)}
								className="flex flex-col items-start gap-1 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-all hover:border-accent hover:bg-accent-muted"
							>
								<span className="text-sm font-medium text-text">{preset.label}</span>
								<Mono size="xs" className="text-text-dim">{preset.description}</Mono>
							</button>
						))}
					</div>
				</div>
			)}

			{/* JSON editor */}
			<div className="relative">
				<textarea
					value={json}
					onChange={handleChange}
					spellCheck={false}
					className={cn(
						'w-full min-h-[320px] resize-y rounded-lg border p-4 font-mono text-xs leading-relaxed',
						'bg-surface text-text placeholder:text-text-dim',
						'focus:outline-none focus:ring-2 focus:ring-accent/50',
						error ? 'border-danger' : 'border-border',
					)}
				/>
				{error && (
					<div className="mt-1 text-xs text-danger font-mono">{error}</div>
				)}
			</div>

			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<Mono size="xs" className="text-text-dim">
						{isDirty ? 'Unsaved changes' : 'Up to date'}
					</Mono>
					{!templatesOpen && rules.length === 0 && (
						<button
							type="button"
							onClick={() => setTemplatesOpen(true)}
							className="text-[11px] text-accent hover:underline"
						>
							Show templates
						</button>
					)}
				</div>
				<Button
					onClick={handleSave}
					disabled={!isDirty || saving}
					size="sm"
				>
					{saving ? (
						<>
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
							Saving...
						</>
					) : (
						<>
							<Save className="h-3.5 w-3.5" />
							Save Rules
						</>
					)}
				</Button>
			</div>

			{/* Collapsible criteria reference */}
			<button
				type="button"
				onClick={() => setRefOpen((v) => !v)}
				className="flex items-center gap-1.5 text-xs text-text-dim hover:text-text transition-colors"
			>
				{refOpen ? (
					<ChevronDown className="h-3.5 w-3.5" />
				) : (
					<ChevronRight className="h-3.5 w-3.5" />
				)}
				Criteria Reference
			</button>

			{refOpen && (
				<div className="rounded-lg border border-border bg-surface p-4 font-mono text-xs leading-relaxed text-text-muted space-y-3">
					<div className="text-text font-semibold">Available criteria types:</div>
					<div className="text-text-dim text-[11px]">
						Rules are evaluated top-down. First rule where ALL criteria match wins. No match = default deny.
					</div>
					<div className="border-t border-border" />
					{CRITERIA_TYPES.map((ct) => (
						<div key={ct.type} className="py-1">
							<div className="flex items-center gap-2">
								<span className="text-accent font-semibold">{ct.type}</span>
								<span className="text-text-dim">&mdash;</span>
								<span>{ct.description}</span>
							</div>
							<div className="mt-0.5 ml-2 text-text-dim">
								<span className="text-text-muted break-all">{ct.schema}</span>
							</div>
						</div>
					))}
					<div className="border-t border-border pt-2 text-text-dim">
						Wei reference: 1 ETH = 1000000000000000000 (10^18 wei)
						<br />
						{weiToEth('100000000000000000')} = 0.1 ETH &middot; {weiToEth('1000000000000000000')} = 1 ETH
					</div>
				</div>
			)}
		</div>
	);
}
