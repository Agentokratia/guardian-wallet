import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
	AlertTriangle,
	ArrowRight,
	Check,
	CheckCircle2,
	Copy,
	Key,
	Lock,
	Shield,
	Terminal,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CopyButton } from './credential-cards';
import type { CreationResult } from './types';

/* -------------------------------------------------------------------------- */
/*  Props                                                                      */
/* -------------------------------------------------------------------------- */

interface DonePhaseProps {
	name: string;
	result: CreationResult;
	onGuardrails: () => void;
	onSkip: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Inline copy button                                                         */
/* -------------------------------------------------------------------------- */

function InlineCopy({ text }: { text: string }) {
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
			className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-text-dim hover:text-text transition-colors"
			aria-label={copied ? 'Copied' : 'Copy'}
		>
			{copied ? <Check className="h-2.5 w-2.5 text-success" /> : <Copy className="h-2.5 w-2.5" />}
		</button>
	);
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function DonePhase({ name, result, onGuardrails, onSkip }: DonePhaseProps) {
	return (
		<div className="space-y-5 animate-in fade-in duration-300">
			{/* ─── Success banner ───────────────────────────────────────── */}
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
				</div>
			</div>

			{/* ─── Non-recoverable warning (safety net — should not appear in normal flow) */}
			{!result.backupStored && (
				<div className="rounded-xl border border-warning/30 bg-warning/[0.04]">
					<div className="flex items-start gap-3 px-5 py-4">
						<AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" aria-hidden="true" />
						<div>
							<p className="text-[13px] font-semibold text-warning">Backup not set up</p>
							<p className="text-[11px] text-text-dim mt-1 leading-relaxed">
								Your agent can still sign transactions, but you can't sign from this dashboard. If
								your agent's credentials are lost, this account can't be recovered.
							</p>
						</div>
					</div>
				</div>
			)}

			{/* ─── Credentials card ───────────────────────────────────── */}
			<Card className="border-accent/40 ring-1 ring-accent/10 bg-surface">
				<CardContent className="p-4 space-y-4">
					<div className="flex items-center gap-3">
						<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-foreground">
							1
						</div>
						<div className="flex-1 min-w-0">
							<p className="text-[13px] font-semibold text-text">Save your credentials</p>
							<p className="text-[10px] text-text-dim mt-0.5">
								Your agent needs these to connect and sign transactions.
							</p>
						</div>
					</div>

					{/* API Key */}
					<div className="rounded-lg border border-border bg-background px-3.5 py-2.5">
						<div className="flex items-center justify-between mb-1.5">
							<div className="flex items-center gap-1.5">
								<Key className="h-3 w-3 text-text-dim" />
								<span className="text-[10px] font-medium uppercase tracking-wider text-text-dim">
									API Key
								</span>
							</div>
							<span className="text-[9px] font-medium text-warning px-1.5 py-0.5 rounded bg-warning/10">
								shown only once
							</span>
						</div>
						<div className="flex items-center gap-2">
							<code className="flex-1 font-mono text-[11px] text-text break-all select-all">
								{result.apiKey}
							</code>
							<CopyButton text={result.apiKey} />
						</div>
					</div>

					{/* API Secret */}
					<div className="rounded-lg border border-border bg-background px-3.5 py-2.5">
						<div className="flex items-center justify-between mb-1.5">
							<div className="flex items-center gap-1.5">
								<Lock className="h-3 w-3 text-text-dim" />
								<span className="text-[10px] font-medium uppercase tracking-wider text-text-dim">
									API Secret
								</span>
							</div>
							<span className="text-[9px] font-medium text-warning px-1.5 py-0.5 rounded bg-warning/10">
								shown only once
							</span>
						</div>
						<div className="flex items-center gap-2">
							<code className="flex-1 font-mono text-[11px] text-text break-all select-all truncate">
								{result.apiSecret.slice(0, 40)}...
							</code>
							<CopyButton text={result.apiSecret} />
						</div>
						<p className="text-[10px] text-text-dim mt-1.5 leading-relaxed">
							Treat this like a password. You cannot retrieve it after leaving this page.
						</p>
					</div>
				</CardContent>
			</Card>

			{/* ─── Connect your agent card ────────────────────────────── */}
			<Card className="border-border bg-surface">
				<CardContent className="p-4 space-y-4">
					<div className="flex items-center gap-3">
						<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-[11px] font-bold text-text-dim">
							2
						</div>
						<div className="flex-1 min-w-0">
							<p className="text-[13px] font-semibold text-text">Connect your agent</p>
							<p className="text-[10px] text-text-dim mt-0.5">
								Install the Guardian Wallet CLI, then link it to this account.
							</p>
						</div>
						<Terminal className="h-4 w-4 text-text-dim shrink-0" />
					</div>

					{/* Install */}
					<div className="rounded-lg border border-border bg-background px-3.5 py-2.5">
						<div className="flex items-center justify-between mb-1.5">
							<span className="text-[10px] font-medium uppercase tracking-wider text-text-dim">
								Install
							</span>
							<InlineCopy text="npm install -g @agentokratia/guardian-wallet" />
						</div>
						<code className="block font-mono text-[12px] text-text select-all">
							npm install -g @agentokratia/guardian-wallet
						</code>
						<p className="text-[10px] text-text-dim mt-1.5 leading-relaxed">
							This installs the <code className="font-mono text-text">gw</code> command on your
							machine.
						</p>
					</div>

					{/* Connect */}
					<div className="rounded-lg border border-border bg-background px-3.5 py-2.5">
						<div className="flex items-center justify-between mb-1.5">
							<span className="text-[10px] font-medium uppercase tracking-wider text-text-dim">
								Connect to this account
							</span>
							<InlineCopy text="gw init" />
						</div>
						<code className="block font-mono text-[13px] text-text select-all">gw init</code>
						<p className="text-[10px] text-text-dim mt-1.5 leading-relaxed">
							Paste your API Key and API Secret when prompted.
						</p>
					</div>

					{/* Verify */}
					<div className="rounded-lg border border-border bg-background px-3.5 py-2.5">
						<div className="flex items-center justify-between mb-1.5">
							<span className="text-[10px] font-medium uppercase tracking-wider text-text-dim">
								Verify the connection
							</span>
							<InlineCopy text="gw status" />
						</div>
						<code className="block font-mono text-[13px] text-text select-all">gw status</code>
						<p className="text-[10px] text-text-dim mt-1.5 leading-relaxed">
							You should see your account name and Ethereum address.
						</p>
					</div>
				</CardContent>
			</Card>

			{/* ─── Guardrails CTA ────────────────────────────────────── */}
			<Card className="border-border bg-surface">
				<CardContent className="p-4">
					<div className="flex items-center gap-3">
						<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-[11px] font-bold text-text-dim">
							3
						</div>
						<div className="flex-1 min-w-0">
							<p className="text-[13px] font-semibold text-text">Set spending limits</p>
							<p className="text-[11px] text-text-dim mt-0.5">
								Control how much this account can spend, which contracts it can interact with, and
								how often it can sign.
							</p>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* ─── CTAs ──────────────────────────────────────────────── */}
			<div className="space-y-2 pt-1">
				<Button onClick={onGuardrails} className="w-full h-12 text-[14px]" size="lg">
					<Shield className="h-4 w-4" aria-hidden="true" />
					Set Up Guardrails
					<ArrowRight className="h-4 w-4" aria-hidden="true" />
				</Button>
				<button
					type="button"
					onClick={onSkip}
					className="w-full text-center text-[12px] text-text-dim hover:text-text-muted transition-colors py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded"
				>
					Go to {name} without guardrails
				</button>
			</div>

			{/* ─── Dashboard signing footnote ─────────────────────────── */}
			{result.backupStored && (
				<div className="flex items-center justify-center gap-1.5 text-[10px] text-text-dim">
					<Check className="h-3 w-3 text-success" />
					<span>Dashboard signing enabled via Touch ID</span>
				</div>
			)}
		</div>
	);
}
