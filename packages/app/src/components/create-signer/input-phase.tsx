import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ChevronRight } from 'lucide-react';
import type { FormEvent } from 'react';
import { useCallback } from 'react';
import { ACCOUNT_TYPES } from './types';

/* -------------------------------------------------------------------------- */
/*  Props                                                                      */
/* -------------------------------------------------------------------------- */

interface InputPhaseProps {
	name: string;
	description: string;
	accountType: string;
	isAuthenticated: boolean;
	onNameChange: (value: string) => void;
	onDescriptionChange: (value: string) => void;
	onAccountTypeChange: (value: string) => void;
	onCreate: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function InputPhase({
	name,
	description,
	accountType,
	isAuthenticated,
	onNameChange,
	onDescriptionChange,
	onAccountTypeChange,
	onCreate,
}: InputPhaseProps) {
	const selectedType = ACCOUNT_TYPES.find((t) => t.value === accountType);

	const handleSubmit = useCallback(
		(e: FormEvent) => {
			e.preventDefault();
			if (name.trim() && isAuthenticated) onCreate();
		},
		[name, isAuthenticated, onCreate],
	);

	return (
		<form onSubmit={handleSubmit} className="space-y-6">
			{/* ---- Name ---- */}
			<div>
				<label htmlFor="signer-name" className="mb-1.5 block text-[13px] font-medium text-text">
					Account name
				</label>
				<Input
					id="signer-name"
					name="signer-name"
					placeholder="e.g. my-trading-bot"
					value={name}
					onChange={(e) =>
						onNameChange(
							e.target.value
								.toLowerCase()
								.replace(/\s+/g, '-')
								.replace(/[^a-z0-9-]/g, ''),
						)
					}
					className="bg-surface h-11 text-[14px]"
					autoFocus
					required
					aria-required="true"
					autoComplete="off"
					spellCheck={false}
				/>
				<p className="mt-1.5 text-[11px] text-text-dim">A unique name for this account.</p>
			</div>

			{/* ---- Description ---- */}
			<div>
				<label htmlFor="signer-desc" className="mb-1.5 block text-[13px] font-medium text-text">
					Description <span className="text-text-dim font-normal">(optional)</span>
				</label>
				<Input
					id="signer-desc"
					name="signer-description"
					placeholder="What will this account do?"
					value={description}
					onChange={(e) => onDescriptionChange(e.target.value)}
					className="bg-surface h-11 text-[14px]"
					autoComplete="off"
				/>
			</div>

			{/* ---- Account type — compact pill selector ---- */}
			<fieldset>
				<legend className="mb-2.5 block text-[13px] font-medium text-text">Account type</legend>
				<div role="radiogroup" aria-label="Account type" className="flex flex-wrap gap-2">
					{ACCOUNT_TYPES.map((t) => {
						const isSelected = accountType === t.value;
						return (
							<button
								key={t.value}
								type="button"
								aria-pressed={isSelected}
								onClick={() => onAccountTypeChange(t.value)}
								className={cn(
									'flex items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] font-medium transition-colors',
									'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background',
									isSelected
										? 'border-accent bg-accent/[0.08] text-accent ring-1 ring-accent/30'
										: 'border-border bg-surface text-text-muted hover:border-border-hover hover:bg-surface-hover hover:text-text',
								)}
							>
								<t.icon
									className={cn('h-3.5 w-3.5', isSelected ? 'text-accent' : 'text-text-dim')}
									aria-hidden="true"
								/>
								{t.label}
							</button>
						);
					})}
				</div>
				{/* Selected type subtitle */}
				{selectedType && (
					<p className="mt-2.5 text-[12px] text-text-muted animate-in fade-in duration-200">
						{selectedType.subtitle}
					</p>
				)}
			</fieldset>

			{/* ---- Submit ---- */}
			<div className="pt-2">
				{!isAuthenticated && (
					<div className="mb-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
						<p className="text-[12px] text-warning">Connect your wallet to create an account.</p>
					</div>
				)}

				<Button
					type="submit"
					disabled={!name.trim() || !isAuthenticated}
					className="w-full h-12 text-[14px]"
					size="lg"
				>
					Create Account
					<ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
				</Button>
			</div>
		</form>
	);
}
