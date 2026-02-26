import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AlertTriangle, Check, Fingerprint, Loader2 } from 'lucide-react';

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const CREATION_STEPS = [
	'Creating your account\u2026',
	'Generating signing keys\u2026',
	'Securing with Touch ID\u2026',
] as const;

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

interface CreatingPhaseProps {
	step?: number;
	/** If set, step 2 shows an error state with retry */
	encryptError?: string;
	onRetryEncrypt?: () => void;
}

export function CreatingPhase({ step = 0, encryptError, onRetryEncrypt }: CreatingPhaseProps) {
	const hasEncryptError = !!encryptError && step >= 2;

	return (
		<output
			aria-live="polite"
			className="block rounded-xl border border-border bg-surface px-6 py-8"
		>
			<div className="mx-auto max-w-xs space-y-4">
				{CREATION_STEPS.map((label, i) => {
					const isActive = i === step && !hasEncryptError;
					const isDone = i < step;
					const isError = i === 2 && hasEncryptError;
					return (
						<div key={label} className="flex items-center gap-3">
							{isDone ? (
								<div className="flex h-5 w-5 items-center justify-center rounded-full bg-success/10">
									<Check className="h-3 w-3 text-success" aria-hidden="true" />
								</div>
							) : isError ? (
								<div className="flex h-5 w-5 items-center justify-center rounded-full bg-warning/10">
									<AlertTriangle className="h-3 w-3 text-warning" aria-hidden="true" />
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
									isError && 'font-medium text-warning',
									!isActive && !isDone && !isError && 'text-text-dim',
								)}
							>
								{label}
							</span>
						</div>
					);
				})}
			</div>

			{/* Encrypt error — retry only, backup is mandatory */}
			{hasEncryptError && (
				<div className="mx-auto mt-6 max-w-xs space-y-4">
					<div className="rounded-lg border border-warning/20 bg-warning/[0.04] px-4 py-3">
						<p className="text-[12px] font-medium text-warning leading-relaxed">
							Touch ID was cancelled
						</p>
						<p className="text-[11px] text-text-dim mt-2 leading-relaxed">
							This step is required to finish setting up your account. It only takes a second.
						</p>
					</div>

					<Button onClick={onRetryEncrypt} className="w-full" size="lg">
						<Fingerprint className="h-4 w-4" aria-hidden="true" />
						Try again
					</Button>
				</div>
			)}
		</output>
	);
}
