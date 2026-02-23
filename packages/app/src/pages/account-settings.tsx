import { SignerSubnav } from '@/components/signer-subnav';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { useSigner } from '@/hooks/use-signer';
import { usePauseSigner, useResumeSigner, useRevokeSigner } from '@/hooks/use-signer-actions';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api-client';
import { Check, Copy, KeyRound, Loader2, Lock, Pause, Play, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';

/* ========================================================================== */
/*  Sub-components                                                             */
/* ========================================================================== */

function CopyButton({ text, className }: { text: string; className?: string }) {
	const [copied, setCopied] = useState(false);
	const handleCopy = async () => {
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};
	return (
		<button
			type="button"
			onClick={handleCopy}
			className={`shrink-0 transition-colors ${className ?? 'text-text-dim hover:text-text'}`}
			aria-label="Copy"
		>
			{copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
		</button>
	);
}

/* ========================================================================== */
/*  Main page                                                                  */
/* ========================================================================== */

export function AccountSettingsPage() {
	const { id } = useParams<{ id: string }>();
	const signerId = id ?? '';
	const { toast } = useToast();

	const { data: signer } = useSigner(signerId);

	const [regenerateKeyOpen, setRegenerateKeyOpen] = useState(false);
	const [newApiKey, setNewApiKey] = useState<string | null>(null);
	const [regenerating, setRegenerating] = useState(false);

	const pauseSigner = usePauseSigner();
	const resumeSigner = useResumeSigner();
	const revokeSigner = useRevokeSigner();

	const handlePause = () => {
		pauseSigner.mutate(signerId, {
			onSuccess: () => toast({ title: 'Account paused', description: 'Account has been paused.' }),
			onError: () =>
				toast({ title: 'Error', description: 'Failed to pause account.', variant: 'destructive' }),
		});
	};

	const handleResume = () => {
		resumeSigner.mutate(signerId, {
			onSuccess: () => toast({ title: 'Account resumed', description: 'Account is now active.' }),
			onError: () =>
				toast({ title: 'Error', description: 'Failed to resume account.', variant: 'destructive' }),
		});
	};

	const handleRevoke = () => {
		if (!window.confirm('Are you sure you want to revoke this account? This cannot be undone.')) {
			return;
		}
		revokeSigner.mutate(signerId, {
			onSuccess: () =>
				toast({ title: 'Account revoked', description: 'Account has been permanently revoked.' }),
			onError: () =>
				toast({ title: 'Error', description: 'Failed to revoke account.', variant: 'destructive' }),
		});
	};

	const handleRegenerateKey = async () => {
		setRegenerating(true);
		try {
			const result = await api.post<{ apiKey: string }>(`/signers/${signerId}/regenerate-key`);
			setNewApiKey(result.apiKey);
		} catch {
			toast({
				title: 'Error',
				description: 'Failed to regenerate API key.',
				variant: 'destructive',
			});
		} finally {
			setRegenerating(false);
		}
	};

	return (
		<SignerSubnav>
			<div className="mx-auto max-w-xl space-y-5">
				{/* ── Security — API Key ──────────────────────────────── */}
				<div>
					<div className="flex items-center gap-2 mb-2">
						<KeyRound className="h-4 w-4 text-text-dim" />
						<h2 className="text-[15px] font-semibold text-text">Security</h2>
					</div>
					<div className="rounded-xl border border-border bg-surface px-4 py-3">
						<div className="flex items-center justify-between mb-1.5">
							<h3 className="text-sm font-semibold text-text">API Key</h3>
							<button
								type="button"
								onClick={() => {
									setNewApiKey(null);
									setRegenerateKeyOpen(true);
								}}
								className="inline-flex items-center gap-1 text-xs text-text-dim hover:text-accent transition-colors"
							>
								<RefreshCw className="h-3 w-3" />
								Regenerate
							</button>
						</div>
						<code className="block truncate font-mono text-xs font-medium text-text-muted">
							gw_live_{'*'.repeat(12)}
						</code>
						<p className="text-[11px] text-text-dim mt-1.5">
							Regenerating will invalidate all current integrations.
						</p>
					</div>
				</div>

				{/* ── Account Control ─────────────────────────────────── */}
				{signer && (
					<div>
						<h2 className="mb-2 text-[15px] font-semibold text-text">Account Control</h2>
						<div className="rounded-xl border border-border bg-surface px-4 py-3 space-y-3">
							{signer.status === 'active' && (
								<div className="flex items-center justify-between gap-3">
									<div className="min-w-0">
										<h3 className="text-sm font-semibold text-text">Pause</h3>
										<p className="text-[11px] text-text-dim">Stop all signing temporarily.</p>
									</div>
									<Button
										variant="outline"
										size="sm"
										onClick={handlePause}
										disabled={pauseSigner.isPending}
										className="shrink-0"
									>
										<Pause className="h-3.5 w-3.5" />
										Pause
									</Button>
								</div>
							)}
							{signer.status === 'paused' && (
								<div className="flex items-center justify-between gap-3">
									<div className="min-w-0">
										<h3 className="text-sm font-semibold text-text">Resume</h3>
										<p className="text-[11px] text-text-dim">Re-enable signing.</p>
									</div>
									<Button
										variant="outline"
										size="sm"
										onClick={handleResume}
										disabled={resumeSigner.isPending}
										className="shrink-0"
									>
										<Play className="h-3.5 w-3.5" />
										Resume
									</Button>
								</div>
							)}
							{signer.status !== 'revoked' && (
								<>
									<div className="border-t border-border" />
									<div className="flex items-center justify-between gap-3">
										<div className="min-w-0">
											<h3 className="text-sm font-semibold text-danger">Revoke</h3>
											<p className="text-[11px] text-text-dim">Permanent. Cannot be undone.</p>
										</div>
										<Button
											variant="destructive"
											size="sm"
											onClick={handleRevoke}
											disabled={revokeSigner.isPending}
											className="shrink-0"
										>
											<Trash2 className="h-3.5 w-3.5" />
											Revoke
										</Button>
									</div>
								</>
							)}
						</div>
					</div>
				)}

				{/* ── Account Info ────────────────────────────────────── */}
				{signer && (
					<div>
						<h2 className="mb-2 text-[15px] font-semibold text-text">Account Info</h2>
						<div className="rounded-xl border border-border bg-surface px-4 py-3">
							<dl className="space-y-2 text-sm">
								<div className="flex justify-between gap-2">
									<dt className="text-text-dim shrink-0">Address</dt>
									<dd className="flex items-center gap-1.5 text-text font-mono text-[11px] truncate">
										{signer.ethAddress.slice(0, 10)}...{signer.ethAddress.slice(-6)}
										<CopyButton text={signer.ethAddress} />
									</dd>
								</div>
								<div className="flex justify-between">
									<dt className="text-text-dim">Created</dt>
									<dd className="text-text text-xs">
										{new Date(signer.createdAt).toLocaleDateString()}
									</dd>
								</div>
								<div className="flex justify-between">
									<dt className="text-text-dim">Scheme</dt>
									<dd className="text-text text-xs">{signer.scheme}</dd>
								</div>
								<div className="flex justify-between">
									<dt className="text-text-dim">Chain</dt>
									<dd className="text-text text-xs">{signer.chain}</dd>
								</div>
								<div className="flex justify-between">
									<dt className="text-text-dim">Key setup</dt>
									<dd className="text-text text-xs">
										{signer.dkgCompleted ? 'Complete' : 'In progress'}
									</dd>
								</div>
							</dl>
						</div>
					</div>
				)}

				{/* Trust footer */}
				<div className="flex items-center justify-center gap-1.5 text-[11px] text-text-dim">
					<Lock className="h-3 w-3" />
					<span>Split-key security — no single point of failure</span>
				</div>
			</div>

			{/* ================================================================ */}
			{/*  DIALOGS                                                         */}
			{/* ================================================================ */}
			<Dialog open={regenerateKeyOpen} onOpenChange={setRegenerateKeyOpen}>
				<DialogContent className="border-border bg-surface sm:max-w-md">
					<DialogHeader>
						<DialogTitle className="text-text">Regenerate API Key</DialogTitle>
						<DialogDescription className="text-text-muted">
							{newApiKey
								? 'Copy this key now. It will not be shown again.'
								: 'Generate a new API key. The old key will stop working immediately.'}
						</DialogDescription>
					</DialogHeader>
					{newApiKey ? (
						<div className="space-y-3">
							<div className="flex items-center gap-2 rounded-lg border border-border bg-surface-hover p-3">
								<code className="flex-1 break-all font-mono text-xs text-text">{newApiKey}</code>
								<CopyButton text={newApiKey} />
							</div>
							<Button className="w-full" onClick={() => setRegenerateKeyOpen(false)}>
								Done
							</Button>
						</div>
					) : (
						<div className="flex justify-end gap-2 pt-2">
							<Button variant="ghost" onClick={() => setRegenerateKeyOpen(false)}>
								Cancel
							</Button>
							<Button onClick={handleRegenerateKey} disabled={regenerating}>
								{regenerating ? (
									<>
										<Loader2 className="h-3.5 w-3.5 animate-spin" />
										Generating...
									</>
								) : (
									<>
										<KeyRound className="h-3.5 w-3.5" />
										Generate New Key
									</>
								)}
							</Button>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</SignerSubnav>
	);
}
