import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { downloadFile } from '@/lib/download';
import { cn } from '@/lib/utils';
import { AlertTriangle, Check, Copy, Download, Key, Lock, Shield } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

/* -------------------------------------------------------------------------- */
/*  CopyButton                                                                 */
/* -------------------------------------------------------------------------- */

export function CopyButton({ text, className }: { text: string; className?: string }) {
	const [copied, setCopied] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout>>();

	useEffect(() => () => clearTimeout(timerRef.current), []);

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(text);
		setCopied(true);
		clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => setCopied(false), 2000);
	}, [text]);

	return (
		<button
			type="button"
			onClick={handleCopy}
			className={cn(
				'shrink-0 text-text-dim hover:text-text transition-colors',
				'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-background rounded',
				className,
			)}
			aria-label={copied ? 'Copied' : 'Copy to clipboard'}
		>
			{copied ? (
				<Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
			) : (
				<Copy className="h-3.5 w-3.5" aria-hidden="true" />
			)}
			<span className="sr-only" aria-live="polite">
				{copied ? 'Copied to clipboard' : ''}
			</span>
		</button>
	);
}

/* -------------------------------------------------------------------------- */
/*  API Key Card                                                               */
/* -------------------------------------------------------------------------- */

interface ApiKeyCardProps {
	apiKey: string;
}

export function ApiKeyCard({ apiKey }: ApiKeyCardProps) {
	return (
		<Card className="border-border bg-surface">
			<CardContent className="p-4 space-y-2.5">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<Key className="h-3.5 w-3.5 text-text-dim" aria-hidden="true" />
						<span className="text-[13px] font-semibold text-text">API Key</span>
					</div>
					<span className="text-[10px] font-medium text-warning px-1.5 py-0.5 rounded bg-warning/10">
						shown only once
					</span>
				</div>
				<div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
					<code className="flex-1 font-mono text-xs text-text break-all select-all">{apiKey}</code>
					<CopyButton text={apiKey} />
				</div>
				<p className="text-[11px] text-text-dim leading-relaxed">
					Paste this into your bot or script configuration to authenticate.
				</p>
			</CardContent>
		</Card>
	);
}

/* -------------------------------------------------------------------------- */
/*  Dashboard Access Card (backup key)                                         */
/* -------------------------------------------------------------------------- */

interface BackupKeyCardProps {
	name: string;
	backupStored: boolean;
	backupPayload: string;
}

export function BackupKeyCard({ name, backupStored, backupPayload }: BackupKeyCardProps) {
	const handleDownloadBackup = useCallback(() => {
		if (!backupPayload) return;
		const blob = new Blob([backupPayload], { type: 'application/json' });
		downloadFile(blob, `${name || 'signer'}.guardian-backup.json`);
	}, [backupPayload, name]);

	return (
		<Card
			className={cn(
				'border-border bg-surface transition-colors',
				backupStored ? '' : 'border-warning/30',
			)}
		>
			<CardContent className="p-4 space-y-2.5">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<Shield className="h-3.5 w-3.5 text-text-dim" aria-hidden="true" />
						<span className="text-[13px] font-semibold text-text">Dashboard Signing</span>
					</div>
					{backupStored ? (
						<span className="text-[10px] font-medium text-success px-1.5 py-0.5 rounded bg-success/10 flex items-center gap-1">
							<Lock className="h-3 w-3" aria-hidden="true" /> secured
						</span>
					) : (
						<span className="text-[10px] font-medium text-warning px-1.5 py-0.5 rounded bg-warning/10">
							not set up
						</span>
					)}
				</div>
				{backupStored ? (
					<>
						<p className="text-[11px] text-text-dim leading-relaxed">
							Protected by Touch ID. You can sign transactions directly from this dashboard.
						</p>
						<Button
							variant="outline"
							className="w-full"
							onClick={handleDownloadBackup}
							disabled={!backupPayload}
						>
							<Download className="h-3.5 w-3.5" aria-hidden="true" />
							Download backup copy
						</Button>
					</>
				) : (
					<div className="flex items-center gap-2">
						<AlertTriangle className="h-4 w-4 text-warning shrink-0" aria-hidden="true" />
						<p className="text-[11px] text-warning leading-relaxed">
							Touch ID setup was skipped. You can still sign from the CLI, but not from this
							dashboard.
						</p>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
