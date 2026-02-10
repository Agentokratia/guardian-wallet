import { PolicyJsonEditor } from '@/components/policy-editor';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Pill } from '@/components/ui/pill';
import {
	usePolicy,
	useSavePolicy,
} from '@/hooks/use-policies';
import { useSigner } from '@/hooks/use-signer';
import { usePauseSigner, useResumeSigner, useRevokeSigner } from '@/hooks/use-signer-actions';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api-client';
import { getTypeIcon, statusConfig } from '@/lib/signer-constants';
import {
	ArrowLeft,
	Check,
	Copy,
	KeyRound,
	Loader2,
	Lock,
	Pause,
	Play,
	RefreshCw,
	Shield,
	Trash2,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

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

	const { data: signer, isLoading: signerLoading } = useSigner(signerId);
	const { data: policyDoc, isLoading: policiesLoading } = usePolicy(signerId);

	const [regenerateKeyOpen, setRegenerateKeyOpen] = useState(false);
	const [newApiKey, setNewApiKey] = useState<string | null>(null);
	const [regenerating, setRegenerating] = useState(false);
	const [policySaving, setPolicySaving] = useState(false);

	const savePolicy = useSavePolicy();
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
			toast({ title: 'Error', description: 'Failed to regenerate API key.', variant: 'destructive' });
		} finally {
			setRegenerating(false);
		}
	};

	const handlePolicySave = useCallback(
		async (rules: Record<string, unknown>[]) => {
			setPolicySaving(true);
			try {
				await savePolicy.mutateAsync({ signerId, rules });
				toast({ title: 'Policy saved', description: 'Rules have been updated.' });
			} catch {
				toast({ title: 'Error', description: 'Failed to save policy.', variant: 'destructive' });
			} finally {
				setPolicySaving(false);
			}
		},
		[signerId, savePolicy, toast],
	);

	if (signerLoading) {
		return (
			<div className="mx-auto max-w-2xl">
				<Link
					to={`/signers/${signerId}`}
					className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-text-dim hover:text-text-muted transition-colors"
				>
					<ArrowLeft className="h-3.5 w-3.5" />
					Back to account
				</Link>
				<div className="animate-pulse space-y-4">
					<div className="h-8 w-48 rounded bg-surface-hover" />
					<div className="h-[200px] rounded-xl bg-surface-hover" />
				</div>
			</div>
		);
	}

	if (!signer) {
		return (
			<div className="mx-auto max-w-2xl">
				<Link
					to="/signers"
					className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-text-dim hover:text-text-muted transition-colors"
				>
					<ArrowLeft className="h-3.5 w-3.5" />
					Accounts
				</Link>
				<div className="rounded-xl border border-border bg-surface px-6 py-16 text-center">
					<p className="text-sm text-text-muted">Account not found.</p>
				</div>
			</div>
		);
	}

	const status = statusConfig[signer.status];
	const icon = getTypeIcon(signer.type, 'h-4 w-4');
	const ruleCount = policyDoc?.rules?.length ?? 0;

	return (
		<div className="mx-auto max-w-2xl space-y-8">
			{/* Back link */}
			<Link
				to={`/signers/${signerId}`}
				className="inline-flex items-center gap-1.5 text-[13px] text-text-dim hover:text-text-muted transition-colors"
			>
				<ArrowLeft className="h-3.5 w-3.5" />
				{signer.name}
			</Link>

			{/* Page header */}
			<div>
				<div className="flex items-center gap-3">
					<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/[0.06] text-text-muted">
						{icon}
					</div>
					<div>
						<h1 className="text-xl font-bold text-text">Account Settings</h1>
						<p className="text-[12px] text-text-dim font-mono mt-0.5">
							{signer.ethAddress.slice(0, 10)}...{signer.ethAddress.slice(-6)}
						</p>
					</div>
					<div className="ml-auto">
						<Pill color={status.pill}>{status.label}</Pill>
					</div>
				</div>
			</div>

			{/* ================================================================ */}
			{/*  POLICIES                                                        */}
			{/* ================================================================ */}
			<div>
				<div className="flex items-center gap-2 mb-3">
					<Shield className="h-4 w-4 text-text-dim" />
					<h2 className="text-[15px] font-semibold text-text">
						Policies
					</h2>
					{ruleCount > 0 && (
						<span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent/[0.06] px-1.5 text-[11px] font-semibold text-text-muted">
							{ruleCount}
						</span>
					)}
				</div>
				<p className="text-[13px] text-text-dim mb-4">
					Define rules that control what transactions this account can sign. Blocked transactions are logged and rejected automatically.
				</p>
				{policiesLoading ? (
					<div className="space-y-2 animate-pulse">
						{Array.from({ length: 3 }, (_, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
							<div key={`p-${i}`} className="h-14 rounded-lg bg-surface-hover" />
						))}
					</div>
				) : (
					<PolicyJsonEditor
						rules={policyDoc?.rules ?? []}
						onSave={handlePolicySave}
						saving={policySaving}
					/>
				)}
			</div>

			{/* ================================================================ */}
			{/*  SECURITY                                                        */}
			{/* ================================================================ */}
			<div>
				<div className="flex items-center gap-2 mb-3">
					<KeyRound className="h-4 w-4 text-text-dim" />
					<h2 className="text-[15px] font-semibold text-text">Security</h2>
				</div>

				{/* API Key */}
				<div className="rounded-xl border border-border bg-surface px-5 py-4">
					<div className="flex items-center justify-between mb-2">
						<h3 className="text-sm font-semibold text-text">API Key</h3>
						<button
							type="button"
							onClick={() => {
								setNewApiKey(null);
								setRegenerateKeyOpen(true);
							}}
							className="inline-flex items-center gap-1.5 text-xs text-text-dim hover:text-accent transition-colors"
						>
							<RefreshCw className="h-3 w-3" />
							Regenerate
						</button>
					</div>
					<code className="block truncate font-mono text-xs font-medium text-text-muted">
						gw_live_{'*'.repeat(12)}
					</code>
					<p className="text-[11px] text-text-dim mt-2">
						Used by the signer SDK to authenticate signing requests. Keep this secret.
					</p>
				</div>
			</div>

			{/* ================================================================ */}
			{/*  ACCOUNT ACTIONS                                                 */}
			{/* ================================================================ */}
			<div>
				<div className="flex items-center gap-2 mb-3">
					<h2 className="text-[15px] font-semibold text-text">Account Control</h2>
				</div>

				<div className="rounded-xl border border-border bg-surface px-5 py-4 space-y-4">
					{/* Pause / Resume */}
					{signer.status === 'active' && (
						<div className="flex items-center justify-between">
							<div>
								<h3 className="text-sm font-semibold text-text">Pause Account</h3>
								<p className="text-[12px] text-text-dim mt-0.5">
									Temporarily stop all signing. Can be resumed at any time.
								</p>
							</div>
							<Button variant="outline" size="sm" onClick={handlePause} disabled={pauseSigner.isPending}>
								<Pause className="h-4 w-4" />
								Pause
							</Button>
						</div>
					)}
					{signer.status === 'paused' && (
						<div className="flex items-center justify-between">
							<div>
								<h3 className="text-sm font-semibold text-text">Resume Account</h3>
								<p className="text-[12px] text-text-dim mt-0.5">
									Re-enable signing for this account.
								</p>
							</div>
							<Button variant="outline" size="sm" onClick={handleResume} disabled={resumeSigner.isPending}>
								<Play className="h-4 w-4" />
								Resume
							</Button>
						</div>
					)}

					{/* Revoke — danger zone */}
					{signer.status !== 'revoked' && (
						<>
							<div className="border-t border-border" />
							<div className="flex items-center justify-between">
								<div>
									<h3 className="text-sm font-semibold text-danger">Revoke Account</h3>
									<p className="text-[12px] text-text-dim mt-0.5">
										Permanently disable this account. This cannot be undone.
									</p>
								</div>
								<Button variant="destructive" size="sm" onClick={handleRevoke} disabled={revokeSigner.isPending}>
									<Trash2 className="h-4 w-4" />
									Revoke
								</Button>
							</div>
						</>
					)}
				</div>
			</div>

			{/* ================================================================ */}
			{/*  ACCOUNT INFO                                                    */}
			{/* ================================================================ */}
			<div>
				<h2 className="mb-3 text-[15px] font-semibold text-text">Account Info</h2>
				<div className="rounded-xl border border-border bg-surface px-5 py-4">
					<dl className="space-y-3 text-sm">
						<div className="flex justify-between">
							<dt className="text-text-dim">Address</dt>
							<dd className="flex items-center gap-1.5 text-text font-mono text-[12px]">
								{signer.ethAddress.slice(0, 10)}...{signer.ethAddress.slice(-6)}
								<CopyButton text={signer.ethAddress} />
							</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-text-dim">Created</dt>
							<dd className="text-text">{new Date(signer.createdAt).toLocaleDateString()}</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-text-dim">Signing Scheme</dt>
							<dd className="text-text">{signer.scheme}</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-text-dim">Chain</dt>
							<dd className="text-text">{signer.chain}</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-text-dim">Key Generation</dt>
							<dd className="text-text">{signer.dkgCompleted ? 'Complete' : 'Pending'}</dd>
						</div>
					</dl>
				</div>
			</div>

			{/* Trust footer */}
			<div className="flex items-center justify-center gap-1.5 text-[11px] text-text-dim pb-4">
				<Lock className="h-3 w-3" />
				<span>Protected by 2-of-3 threshold cryptography</span>
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
		</div>
	);
}
