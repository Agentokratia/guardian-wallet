import { cn } from '@/lib/utils';
import { Check, Loader2 } from 'lucide-react';

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const CREATION_STEPS = [
	'Creating account\u2026',
	'Generating keys\u2026',
	'Securing your keys\u2026',
] as const;

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

interface CreatingPhaseProps {
	step?: number;
}

export function CreatingPhase({ step = 0 }: CreatingPhaseProps) {
	return (
		<output
			aria-live="polite"
			className="block rounded-xl border border-border bg-surface px-6 py-8"
		>
			<div className="mx-auto max-w-xs space-y-4">
				{CREATION_STEPS.map((label, i) => {
					const isActive = i === step;
					const isDone = i < step;
					return (
						<div key={label} className="flex items-center gap-3">
							{isDone ? (
								<div className="flex h-5 w-5 items-center justify-center rounded-full bg-success/10">
									<Check className="h-3 w-3 text-success" aria-hidden="true" />
								</div>
							) : isActive ? (
								<Loader2
									className="h-5 w-5 animate-spin text-accent motion-reduce:animate-none"
									aria-hidden="true"
								/>
							) : (
								<div className="h-5 w-5 rounded-full border border-border" />
							)}
							<span
								className={cn(
									'text-[13px] transition-colors',
									isActive && 'font-medium text-text',
									isDone && 'text-text-muted',
									!isActive && !isDone && 'text-text-dim',
								)}
							>
								{label}
							</span>
						</div>
					);
				})}
			</div>
		</output>
	);
}
