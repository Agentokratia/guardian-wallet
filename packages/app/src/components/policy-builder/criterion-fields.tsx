/**
 * Dynamic criterion field renderer.
 * Reads CriterionMeta.fields and renders appropriate inputs.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { CriterionMeta, FieldMeta } from '@agentokratia/guardian-core';
import { X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { isAddress } from 'viem';

interface CriterionFieldsProps {
	meta: CriterionMeta;
	values: Record<string, unknown>;
	onChange: (key: string, value: unknown) => void;
	error?: string;
}

export function CriterionFields({ meta, values, onChange, error }: CriterionFieldsProps) {
	return (
		<div className="space-y-3">
			{meta.fields.map((field) => (
				<FieldRenderer
					key={field.key}
					field={field}
					value={values[field.key]}
					onChange={(v) => onChange(field.key, v)}
				/>
			))}
			{error && (
				<p role="alert" className="text-xs text-danger">
					{error}
				</p>
			)}
		</div>
	);
}

interface FieldRendererProps {
	field: FieldMeta;
	value: unknown;
	onChange: (value: unknown) => void;
}

function FieldRenderer({ field, value, onChange }: FieldRendererProps) {
	switch (field.type) {
		case 'number':
		case 'usd':
		case 'eth':
		case 'percent':
		case 'hours':
			return <NumberField field={field} value={value} onChange={onChange} />;
		case 'toggle':
			return <ToggleField field={field} value={value} onChange={onChange} />;
		case 'addresses':
			return <AddressListField field={field} value={value} onChange={onChange} />;
		case 'selectors':
		case 'ips':
			return <StringListField field={field} value={value} onChange={onChange} />;
		case 'chains':
			return <ChainField field={field} value={value} onChange={onChange} />;
		default:
			return null;
	}
}

function NumberField({ field, value, onChange }: FieldRendererProps) {
	const prefix = field.type === 'usd' ? '$' : '';
	const suffix = field.unit && field.type !== 'usd' ? field.unit : '';
	const inputId = `field-${field.key}`;

	return (
		<div>
			<label htmlFor={inputId} className="text-xs text-text-muted">
				{field.label}
			</label>
			<div className="mt-1 flex items-center gap-2">
				{prefix && <span className="text-sm text-text-muted">{prefix}</span>}
				<Input
					id={inputId}
					type="number"
					value={value !== undefined ? String(value) : ''}
					onChange={(e) => {
						const v = e.target.value;
						onChange(v === '' ? undefined : Number(v));
					}}
					placeholder={field.placeholder}
					min={field.min}
					max={field.max}
					className="h-8 max-w-[160px] bg-background text-sm"
				/>
				{suffix && <span className="text-xs text-text-muted">{suffix}</span>}
			</div>
		</div>
	);
}

function ToggleField({ field, value, onChange }: FieldRendererProps) {
	return (
		<div className="flex items-center justify-between">
			<span className="text-xs text-text-muted">{field.label}</span>
			<Switch checked={value !== false} onCheckedChange={onChange} />
		</div>
	);
}

function AddressListField({ field, value, onChange }: FieldRendererProps) {
	const addresses = (value as string[] | undefined) ?? [];
	const [input, setInput] = useState('');
	const inputId = `field-${field.key}`;

	const addAddress = useCallback(() => {
		const trimmed = input.trim();
		if (!trimmed) return;
		if (!isAddress(trimmed)) return;
		if (addresses.includes(trimmed.toLowerCase())) return;
		onChange([...addresses, trimmed.toLowerCase()]);
		setInput('');
	}, [input, addresses, onChange]);

	const removeAddress = useCallback(
		(addr: string) => {
			onChange(addresses.filter((a) => a !== addr));
		},
		[addresses, onChange],
	);

	return (
		<div>
			<label htmlFor={inputId} className="text-xs text-text-muted">
				{field.label}
			</label>
			<div className="mt-1 flex gap-2">
				<Input
					id={inputId}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					placeholder="0x..."
					className="h-8 bg-background font-mono text-xs"
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							addAddress();
						}
					}}
				/>
				<Button variant="outline" size="sm" onClick={addAddress} className="h-8 shrink-0">
					Add
				</Button>
			</div>
			{addresses.length > 0 && (
				<div className="mt-2 space-y-1">
					{addresses.map((addr) => (
						<div
							key={addr}
							className="flex items-center justify-between rounded border border-border bg-background px-2 py-1"
						>
							<span className="font-mono text-[11px] text-text-muted">
								{addr.slice(0, 6)}...{addr.slice(-4)}
							</span>
							<button
								type="button"
								aria-label={`Remove address ${addr.slice(0, 6)}...${addr.slice(-4)}`}
								onClick={() => removeAddress(addr)}
								className="text-text-dim hover:text-danger"
							>
								<X className="h-3 w-3" />
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function StringListField({ field, value, onChange }: FieldRendererProps) {
	const items = (value as string[] | undefined) ?? [];
	const [input, setInput] = useState('');
	const inputId = `field-${field.key}`;

	const addItem = useCallback(() => {
		const trimmed = input.trim();
		if (!trimmed || items.includes(trimmed)) return;
		onChange([...items, trimmed]);
		setInput('');
	}, [input, items, onChange]);

	return (
		<div>
			<label htmlFor={inputId} className="text-xs text-text-muted">
				{field.label}
			</label>
			<div className="mt-1 flex gap-2">
				<Input
					id={inputId}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					placeholder={field.placeholder}
					className="h-8 bg-background font-mono text-xs"
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							addItem();
						}
					}}
				/>
				<Button variant="outline" size="sm" onClick={addItem} className="h-8 shrink-0">
					Add
				</Button>
			</div>
			{items.length > 0 && (
				<div className="mt-2 flex flex-wrap gap-1">
					{items.map((item) => (
						<span
							key={item}
							className="inline-flex items-center gap-1 rounded bg-accent/10 px-2 py-0.5 font-mono text-[11px] text-accent"
						>
							{item}
							<button
								type="button"
								aria-label={`Remove ${item}`}
								onClick={() => onChange(items.filter((i) => i !== item))}
								className="hover:text-danger"
							>
								<X className="h-3 w-3" />
							</button>
						</span>
					))}
				</div>
			)}
		</div>
	);
}

const CHAIN_OPTIONS = [
	{ id: 1, label: 'Ethereum' },
	{ id: 11155111, label: 'Sepolia' },
	{ id: 42161, label: 'Arbitrum' },
	{ id: 8453, label: 'Base' },
	{ id: 10, label: 'Optimism' },
	{ id: 137, label: 'Polygon' },
];

function ChainField({ field, value, onChange }: FieldRendererProps) {
	const selected = (value as number[] | undefined) ?? [];

	const toggle = useCallback(
		(chainId: number) => {
			if (selected.includes(chainId)) {
				onChange(selected.filter((id) => id !== chainId));
			} else {
				onChange([...selected, chainId]);
			}
		},
		[selected, onChange],
	);

	return (
		<div>
			<span id={`label-${field.key}`} className="text-xs text-text-muted">
				{field.label}
			</span>
			<fieldset
				className="mt-1 flex flex-wrap gap-2 border-0 p-0 m-0"
				aria-labelledby={`label-${field.key}`}
			>
				{CHAIN_OPTIONS.map((chain) => (
					<button
						key={chain.id}
						type="button"
						aria-pressed={selected.includes(chain.id)}
						onClick={() => toggle(chain.id)}
						className={cn(
							'rounded-full border px-3 py-1 text-xs transition-colors',
							selected.includes(chain.id)
								? 'border-accent bg-accent/10 text-accent'
								: 'border-border text-text-muted hover:border-accent/50',
						)}
					>
						{chain.label}
					</button>
				))}
			</fieldset>
		</div>
	);
}
