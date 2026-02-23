import { Button } from '@/components/ui/button';
import { ArrowRight, CheckCircle2, Lock, Shield } from 'lucide-react';
import { ApiKeyCard, BackupKeyCard, CopyButton, SecretFileCard } from './credential-cards';
import type { CreationResult } from './types';

/* -------------------------------------------------------------------------- */
/*  Props                                                                      */
/* -------------------------------------------------------------------------- */

interface DonePhaseProps {
	name: string;
	result: CreationResult;
	secretDownloaded: boolean;
	onDownloadSecret: () => void;
	onGuardrails: () => void;
	onSkip: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function DonePhase({
	name,
	result,
	secretDownloaded,
	onDownloadSecret,
	onGuardrails,
	onSkip,
}: DonePhaseProps) {
	return (
		<div className="space-y-5 animate-in fade-in duration-300">
			{/* Success banner */}
			<div className="relative overflow-hidden rounded-xl border border-success/20 bg-success/[0.04]">
				<div className="flex items-center gap-4 px-5 py-4">
					<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/10">
						<CheckCircle2 className="h-4.5 w-4.5 text-success" aria-hidden="true" />
					</div>
					<div className="min-w-0 flex-1">
						<h2 className="text-[15px] font-bold text-text">{name} is ready</h2>
						<div className="mt-0.5 flex items-center gap-2">
							<code className="font-mono text-[12px] text-success truncate">
								{result.ethAddress}
							</code>
							<CopyButton text={result.ethAddress} />
						</div>
					</div>
					<div className="hidden sm:flex items-center gap-1.5 text-[10px] text-text-dim">
						<Lock className="h-3 w-3" aria-hidden="true" />
						<span>Split-key security</span>
					</div>
				</div>
			</div>

			{/* Credentials — vertical sequence, priority order */}
			<div className="space-y-3">
				<SecretFileCard
					name={name}
					secretDownloaded={secretDownloaded}
					onDownload={onDownloadSecret}
				/>

				<ApiKeyCard apiKey={result.apiKey} />

				<BackupKeyCard
					name={name}
					backupStored={result.backupStored}
					backupPayload={result.backupPayload}
				/>
			</div>

			{/* CTA */}
			<div className="space-y-2 pt-1">
				<Button
					onClick={onGuardrails}
					disabled={!secretDownloaded}
					className="w-full h-12 text-[14px]"
					size="lg"
				>
					{secretDownloaded ? (
						<>
							<Shield className="h-4 w-4" aria-hidden="true" />
							Set Up Guardrails
							<ArrowRight className="h-4 w-4" aria-hidden="true" />
						</>
					) : (
						'Download your secret file to continue'
					)}
				</Button>
				{secretDownloaded && (
					<button
						type="button"
						onClick={onSkip}
						className="w-full text-center text-[12px] text-text-dim hover:text-text-muted transition-colors py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded"
					>
						Skip for now — your account will have no spending limits
					</button>
				)}
			</div>
		</div>
	);
}
