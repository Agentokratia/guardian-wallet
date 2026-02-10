import { Mono } from '@/components/ui/mono';
import { cn } from '@/lib/utils';
import { Check, Loader2, Shield } from 'lucide-react';

export type DKGState = 'ready' | 'running' | 'complete' | 'error';

interface DKGProgressProps {
	state: DKGState;
	currentRound: number;
	totalRounds?: number;
	ethAddress?: string;
	errorMessage?: string;
	className?: string;
}

const steps = [
	{ label: 'Creating signer', desc: 'Setting up your account' },
	{ label: 'Generating keys', desc: 'Splitting key into secure parts' },
	{ label: 'Finalizing', desc: 'Deriving your address' },
] as const;

function StepIndicator({
	step,
	currentStep,
	state,
}: {
	step: number;
	currentStep: number;
	state: DKGState;
}) {
	const isComplete = state === 'complete' || (state === 'running' && step < currentStep);
	const isCurrent = state === 'running' && step === currentStep;
	const meta = steps[step - 1];

	return (
		<div className="flex items-center gap-3">
			<div
				className={cn(
					'flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-all',
					isComplete && 'border-success bg-success-muted text-success',
					isCurrent && 'border-accent bg-accent-muted text-accent animate-pulse',
					!isComplete && !isCurrent && 'border-border text-text-dim',
				)}
			>
				{isComplete ? (
					<Check className="h-4 w-4" />
				) : isCurrent ? (
					<Loader2 className="h-4 w-4 animate-spin" />
				) : (
					step
				)}
			</div>
			<div>
				<div
					className={cn(
						'text-sm font-medium',
						isComplete && 'text-success',
						isCurrent && 'text-accent',
						!isComplete && !isCurrent && 'text-text-dim',
					)}
				>
					{meta?.label}
				</div>
				<Mono size="xs" className="text-text-dim">
					{meta?.desc}
				</Mono>
			</div>
		</div>
	);
}

export function DKGProgress({
	state,
	currentRound,
	totalRounds = 3,
	ethAddress,
	errorMessage,
	className,
}: DKGProgressProps) {
	const progressPercent =
		state === 'complete' ? 100 : state === 'running' ? ((currentRound - 1) / totalRounds) * 100 : 0;

	return (
		<div className={cn('space-y-6', className)}>
			{/* Progress bar */}
			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<Mono size="sm" className="text-text-muted">
						{state === 'ready' && 'Ready'}
						{state === 'running' && `Setting up... Step ${currentRound}/${totalRounds}`}
						{state === 'complete' && 'Account created'}
						{state === 'error' && 'Something went wrong'}
					</Mono>
					<Mono size="xs" className="text-text-dim">
						{Math.round(progressPercent)}%
					</Mono>
				</div>
				<div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
					<div
						className={cn(
							'h-full rounded-full transition-all duration-500',
							state === 'error' ? 'bg-danger' : 'bg-accent',
							state === 'complete' && 'bg-success',
						)}
						style={{ width: `${progressPercent}%` }}
					/>
				</div>
			</div>

			{/* Step indicators */}
			<div className="space-y-4">
				{Array.from({ length: totalRounds }, (_, i) => (
					<StepIndicator
						key={`step-${i + 1}`}
						step={i + 1}
						currentStep={currentRound}
						state={state}
					/>
				))}
			</div>

			{/* Error message */}
			{state === 'error' && errorMessage && (
				<div className="rounded-lg border border-danger bg-danger-muted px-4 py-3">
					<Mono size="sm" className="text-danger">
						{errorMessage}
					</Mono>
				</div>
			)}

			{/* Complete: show address */}
			{state === 'complete' && (
				<div className="space-y-3 rounded-lg border border-success/20 bg-success-muted p-4">
					{ethAddress && (
						<div>
							<Mono size="xs" className="text-text-dim">
								Your Address
							</Mono>
							<div className="mt-1 font-mono text-sm text-success">{ethAddress}</div>
						</div>
					)}
					<div className="flex items-center gap-2 text-sm text-text-muted">
						<Shield className="h-3.5 w-3.5 text-success" />
						No single device holds the full key
					</div>
				</div>
			)}
		</div>
	);
}
