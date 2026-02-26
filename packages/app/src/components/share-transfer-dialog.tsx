/**
 * Share Transfer Dialog — PRD-67 Phase 7d
 *
 * Two flows:
 * 1. "Link from CLI" (Import) — claim a pending CLI→Dashboard transfer
 * 2. "Export to CLI" (Export) — initiate a Dashboard→CLI transfer
 *
 * Uses BIP39 words as a human-readable transfer code.
 * The actual share is encrypted with AES-256-GCM keyed via HKDF from the words.
 */

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { ApiError, api } from '@/lib/api-client';
import {
	decryptShareFromTransfer,
	deriveTransferKey,
	encryptShareForTransfer,
	generateTransferCode,
} from '@/lib/transfer-crypto';
import { decryptUserShare, encryptUserShare } from '@/lib/user-share-store';
import { cn } from '@/lib/utils';
import { wipePRF } from '@agentokratia/guardian-auth/browser';
import {
	AlertTriangle,
	ArrowDownToLine,
	ArrowUpFromLine,
	Check,
	Copy,
	Fingerprint,
	Loader2,
	Lock,
	Shield,
	Terminal,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShareTransferDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	signerId: string;
	/** Human-readable signer name, used in CLI command hints. */
	signerName?: string;
	/** Skip the mode selector and open directly into 'import' or 'export'. */
	initialMode?: 'import' | 'export';
}

type Mode = 'select' | 'import' | 'export';

type ImportStep = 'check' | 'waiting' | 'enter-words' | 'claiming' | 'success' | 'error';
type ExportStep = 'confirm' | 'auth' | 'encrypting' | 'show-words' | 'success' | 'error';

interface PendingTransfer {
	id: string;
	direction: string;
	status: string;
	expiresAt: string;
}

/** Extract the human-readable message from an ApiError (server returns JSON). */
function parseApiMessage(err: ApiError): string {
	try {
		const parsed = JSON.parse(err.message) as { message?: string };
		return parsed.message ?? err.message;
	} catch {
		return err.message;
	}
}

// ---------------------------------------------------------------------------
// Import flow component
// ---------------------------------------------------------------------------

function ImportFlow({
	signerId,
	signerName,
	onDone,
}: {
	signerId: string;
	signerName?: string;
	onDone: () => void;
}) {
	const { hasPasskey, setupPasskey, refreshPRF } = useAuth();
	const { toast } = useToast();

	const [step, setStep] = useState<ImportStep>('check');
	const [transfer, setTransfer] = useState<PendingTransfer | null>(null);
	const [words, setWords] = useState<string[]>(['', '', '', '', '', '']);
	const [error, setError] = useState<string | null>(null);
	const [notFoundHint, setNotFoundHint] = useState(false);
	const checkedOnce = useRef(false);
	const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

	// Check for pending transfers
	const checkPending = useCallback(async () => {
		setStep('check');
		try {
			const result = await api.get<{
				transferId: string | null;
				direction: string | null;
				expiresAt: string | null;
			}>(`/auth/transfer/pending?signerId=${signerId}`);

			if (result?.transferId && result.direction === 'cli_to_dashboard') {
				setTransfer({
					id: result.transferId,
					direction: result.direction,
					status: 'pending',
					expiresAt: result.expiresAt as string,
				});
				setNotFoundHint(false);
				setStep('enter-words');
			} else {
				if (checkedOnce.current) {
					setNotFoundHint(true);
				}
				checkedOnce.current = true;
				setStep('waiting');
			}
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) {
				if (checkedOnce.current) setNotFoundHint(true);
				checkedOnce.current = true;
				setStep('waiting');
			} else if (err instanceof ApiError && err.status === 403) {
				setError(
					"You don't have permission to transfer this wallet's recovery key. Make sure you're logged in with the same account that created it.",
				);
				setStep('error');
			} else {
				const detail =
					err instanceof ApiError ? parseApiMessage(err) : err instanceof Error ? err.message : '';
				const msg = detail
					? `Could not reach the server. ${detail}`
					: 'Could not reach the server. Check that your Guardian server is running and try again.';
				setError(msg);
				setStep('error');
			}
		}
	}, [signerId]);

	// Check on mount
	useEffect(() => {
		let cancelled = false;
		checkPending().then(() => {
			if (cancelled) return;
		});
		return () => {
			cancelled = true;
		};
	}, [checkPending]);

	const handleWordChange = useCallback((index: number, value: string) => {
		// Handle paste of all 6 words
		const trimmed = value.trim();
		const pastedWords = trimmed.split(/\s+/);
		if (pastedWords.length === 6) {
			setWords(pastedWords.map((w) => w.toLowerCase()));
			// Focus last input
			inputRefs.current[5]?.focus();
			return;
		}

		setWords((prev) => {
			const next = [...prev];
			next[index] = value.toLowerCase().trim();
			return next;
		});

		// Auto-advance on complete word
		if (value.length >= 3 && index < 5) {
			// Small delay to let state settle
			requestAnimationFrame(() => {
				inputRefs.current[index + 1]?.focus();
			});
		}
	}, []);

	const allWordsFilled = words.every((w) => w.length >= 3);

	const handleClaim = useCallback(async () => {
		if (!transfer) return;
		setStep('claiming');
		setError(null);

		try {
			// 1. Derive transfer key from words
			const transferKey = deriveTransferKey(words, transfer.id);

			// 2. Claim the transfer — get encrypted payload
			const { encryptedPayload } = await api.post<{ encryptedPayload: string }>(
				`/auth/transfer/${transfer.id}/claim`,
			);

			// 3. Decrypt the share with transfer key
			let shareBytes: Uint8Array;
			try {
				shareBytes = await decryptShareFromTransfer(encryptedPayload, transferKey);
			} catch {
				throw new Error(
					'Wrong transfer code. Double-check the 6 words shown in the CLI and try again.',
				);
			}

			// Wipe transfer key
			transferKey.fill(0);

			// 4. Re-encrypt with passkey PRF
			let prfOutput: Uint8Array;
			if (!hasPasskey) {
				const result = await setupPasskey();
				if (!result) {
					shareBytes.fill(0);
					throw new Error('Passkey setup is required to store the signing key securely.');
				}
				prfOutput = result;
			} else {
				prfOutput = await refreshPRF();
			}

			const encrypted = await encryptUserShare(shareBytes, prfOutput);
			// encryptUserShare already wipes shareBytes
			wipePRF(prfOutput);

			// 5. Store re-encrypted share on server
			await api.post(`/signers/${signerId}/user-share`, encrypted);

			// 6. Confirm the transfer
			await api.post(`/auth/transfer/${transfer.id}/confirm`);

			setStep('success');
			toast({ title: 'Dashboard signing enabled' });
		} catch (err) {
			let msg: string;
			if (err instanceof ApiError) {
				if (err.status === 410) {
					msg = 'This transfer has expired. Run `gw link` again to start a new one.';
				} else if (err.status === 409) {
					msg = 'This transfer was already claimed or is locked by another session.';
				} else if (err.status === 404) {
					msg = 'Transfer not found. It may have expired. Run `gw link` again.';
				} else {
					msg = parseApiMessage(err) || `Server error (${err.status})`;
				}
			} else {
				msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
			}
			setError(msg);
			setStep('error');
		}
	}, [transfer, words, signerId, hasPasskey, setupPasskey, refreshPRF, toast]);

	// --- Render by step ---

	if (step === 'check') {
		return (
			<div className="flex flex-col items-center gap-3 py-8">
				<Loader2 className="h-5 w-5 animate-spin text-text-dim" />
				<p className="text-[12px] text-text-dim">Checking for pending transfers...</p>
			</div>
		);
	}

	if (step === 'waiting') {
		const cliName = signerName ?? 'ACCOUNT_NAME';
		return (
			<div className="space-y-5">
				{/* Step-by-step guide */}
				<div className="rounded-xl border border-border bg-background p-4 space-y-4">
					<p className="text-[12px] font-semibold text-text">
						Transfer your recovery key from the CLI
					</p>

					{/* Step 1 */}
					<div className="flex items-start gap-3">
						<span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground">
							1
						</span>
						<div className="flex-1 min-w-0">
							<p className="text-[11px] text-text-muted">Open your terminal and run:</p>
							<code className="mt-1.5 block rounded-lg bg-surface-hover px-3 py-2 font-mono text-[12px] text-text select-all">
								gw link {cliName}
							</code>
						</div>
					</div>

					{/* Step 2 */}
					<div className="flex items-start gap-3">
						<span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground">
							2
						</span>
						<div className="flex-1 min-w-0">
							<p className="text-[11px] text-text-muted">
								Copy the <strong>6 words</strong> shown in the CLI
							</p>
						</div>
					</div>

					{/* Step 3 */}
					<div className="flex items-start gap-3">
						<span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground">
							3
						</span>
						<div className="flex-1 min-w-0">
							<p className="text-[11px] text-text-muted">
								Come back here and click <strong>I have my code</strong>
							</p>
						</div>
					</div>
				</div>

				{/* Not found hint */}
				{notFoundHint && (
					<div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
						<div className="flex items-start gap-2.5">
							<AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
							<p className="text-[11px] text-text-muted leading-relaxed">
								No pending transfer found. Make sure you ran{' '}
								<code className="rounded bg-surface-hover px-1 py-0.5 font-mono text-[10px]">
									gw link {signerName ?? 'ACCOUNT_NAME'}
								</code>{' '}
								in your terminal and it completed successfully.
							</p>
						</div>
					</div>
				)}

				{/* Refresh CTA */}
				<Button className="w-full h-11" onClick={checkPending}>
					{notFoundHint ? 'Check again' : 'I have my code'}
				</Button>

				<div className="flex items-center justify-center gap-1.5 text-[10px] text-text-dim">
					<Shield className="h-3 w-3" />
					<span>The transfer code expires in 10 minutes</span>
				</div>
			</div>
		);
	}

	if (step === 'enter-words') {
		const minutesLeft = transfer
			? Math.max(0, Math.round((new Date(transfer.expiresAt).getTime() - Date.now()) / 60_000))
			: 0;

		return (
			<div className="space-y-5">
				{/* Instructions */}
				<div className="rounded-lg border border-border bg-background px-4 py-3">
					<div className="flex items-start gap-2.5">
						<Terminal className="h-3.5 w-3.5 text-text-muted shrink-0 mt-0.5" />
						<div>
							<p className="text-[12px] font-medium text-text">Enter the 6 words from your CLI</p>
							<p className="text-[11px] text-text-dim mt-1 leading-relaxed">
								The transfer code was displayed when you ran{' '}
								<code className="rounded bg-surface-hover px-1 py-0.5 font-mono text-[10px]">
									gw link
								</code>
								. It expires in{' '}
								<span className="font-semibold text-text-muted">{minutesLeft} min</span>.
							</p>
						</div>
					</div>
				</div>

				{/* Word inputs — 3x2 grid */}
				<div className="grid grid-cols-3 gap-2">
					{words.map((word, i) => (
						<div key={`word-${i}`} className="relative">
							<span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-text-dim/50 select-none">
								{i + 1}.
							</span>
							<Input
								ref={(el) => {
									inputRefs.current[i] = el;
								}}
								value={word}
								onChange={(e) => handleWordChange(i, e.target.value)}
								className="h-10 pl-7 pr-2 font-mono text-[13px] text-text lowercase"
								placeholder="word"
								autoComplete="off"
								spellCheck={false}
								autoFocus={i === 0}
							/>
						</div>
					))}
				</div>

				{/* Claim button */}
				<Button className="w-full h-11" onClick={handleClaim} disabled={!allWordsFilled}>
					<Lock className="h-3.5 w-3.5" />
					Link Signing Key
				</Button>
			</div>
		);
	}

	if (step === 'claiming') {
		return (
			<div className="space-y-4 py-4">
				<div className="space-y-2.5">
					{[
						{ label: 'Verifying transfer code', done: true },
						{ label: 'Decrypting signing key', done: true },
						{ label: 'Securing with your passkey', done: false },
					].map((s) => (
						<div
							key={s.label}
							className={cn(
								'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px]',
								s.done ? 'text-text' : 'text-text-dim',
							)}
						>
							{s.done ? (
								<Loader2 className="h-4 w-4 animate-spin text-accent" />
							) : (
								<div className="h-4 w-4 rounded-full border border-border" />
							)}
							<span className="font-medium">{s.label}</span>
						</div>
					))}
				</div>

				<div className="rounded-lg bg-accent/[0.04] border border-accent/10 px-4 py-3">
					<p className="text-[11px] text-text-dim leading-relaxed">
						<Fingerprint className="h-3 w-3 inline mr-1.5 text-accent" />
						Your browser will prompt for passkey verification to secure the signing key.
					</p>
				</div>
			</div>
		);
	}

	if (step === 'success') {
		return (
			<div className="flex flex-col items-center gap-4 py-6">
				<div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
					<Check className="h-5 w-5 text-success" />
				</div>
				<div className="text-center">
					<p className="text-[14px] font-semibold text-text">Dashboard signing enabled</p>
					<p className="text-[12px] text-text-dim mt-1 leading-relaxed max-w-[280px]">
						You can now sign transactions and manage guardrails from this dashboard.
					</p>
				</div>
				<Button variant="outline" onClick={onDone} className="mt-2">
					Done
				</Button>
			</div>
		);
	}

	// error step
	const isPermissionError = error?.includes('permission');
	return (
		<div className="flex flex-col items-center gap-4 py-6">
			<div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
				<AlertTriangle className="h-5 w-5 text-danger" />
			</div>
			<div className="text-center">
				<p className="text-[14px] font-semibold text-text">
					{isPermissionError ? 'Not authorized' : 'Transfer failed'}
				</p>
				<p className="text-[12px] text-text-dim mt-1 leading-relaxed max-w-[300px]">{error}</p>
			</div>
			<div className="flex gap-2 mt-2">
				<Button variant="outline" onClick={onDone}>
					Close
				</Button>
				{!isPermissionError && (
					<Button
						onClick={() => {
							setError(null);
							setWords(['', '', '', '', '', '']);
							checkPending();
						}}
					>
						Try Again
					</Button>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Export flow component
// ---------------------------------------------------------------------------

function ExportFlow({
	signerId,
	onDone,
}: {
	signerId: string;
	onDone: () => void;
}) {
	const { hasPasskey, setupPasskey, refreshPRF } = useAuth();
	const { toast } = useToast();

	const [step, setStep] = useState<ExportStep>('confirm');
	const [words, setWords] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	// Start the export — only called when user clicks Continue
	const startExport = useCallback(async () => {
		setStep('auth');
		try {
			// 1. Passkey auth — get PRF output
			let prfOutput: Uint8Array;
			if (!hasPasskey) {
				const result = await setupPasskey();
				if (!result) {
					throw new Error('Passkey setup is required to export the signing key.');
				}
				prfOutput = result;
			} else {
				prfOutput = await refreshPRF();
			}

			// 2. Fetch encrypted user share
			setStep('encrypting');
			let encrypted: { iv: string; ciphertext: string; salt: string };
			try {
				encrypted = await api.get<{ iv: string; ciphertext: string; salt: string }>(
					`/signers/${signerId}/user-share`,
				);
			} catch (err) {
				wipePRF(prfOutput);
				if (err instanceof ApiError && err.status === 404) {
					throw new Error('No signing key stored on the dashboard. Link from CLI first.');
				}
				throw new Error('Could not retrieve your signing key.');
			}

			// 3. Decrypt with PRF
			let shareBytes: Uint8Array;
			try {
				shareBytes = await decryptUserShare(encrypted, prfOutput);
			} catch {
				wipePRF(prfOutput);
				throw new Error('Failed to decrypt your signing key. Your passkey may have changed.');
			}
			wipePRF(prfOutput);

			// 4. Initiate transfer on server
			const { transferId } = await api.post<{ transferId: string }>('/auth/transfer/initiate', {
				signerId,
				direction: 'dashboard_to_cli',
			});

			// 5. Generate transfer code + encrypt share
			const { words: transferWords, transferKey } = generateTransferCode(transferId);
			const encryptedPayload = await encryptShareForTransfer(shareBytes, transferKey);

			// Wipe sensitive material
			shareBytes.fill(0);
			transferKey.fill(0);

			// 6. Upload encrypted payload
			await api.patch(`/auth/transfer/${transferId}`, { encryptedPayload });

			setWords(transferWords);
			setStep('show-words');
		} catch (err) {
			let msg: string;
			if (err instanceof ApiError) {
				if (err.status === 403) {
					msg =
						"You don't have permission to export this wallet's recovery key. Make sure you're logged in with the same account that created it.";
				} else {
					msg = parseApiMessage(err) || `Server error (${err.status})`;
				}
			} else {
				msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
			}
			setError(msg);
			setStep('error');
		}
	}, [signerId, hasPasskey, setupPasskey, refreshPRF]);

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(words.join(' '));
		setCopied(true);
		toast({ title: 'Transfer code copied' });
		setTimeout(() => setCopied(false), 3000);
	}, [words, toast]);

	// --- Render by step ---

	if (step === 'confirm') {
		return (
			<div className="space-y-5">
				{/* What this enables */}
				<div className="rounded-xl border border-border bg-background p-4 space-y-3">
					<p className="text-[12px] font-semibold text-text">What this unlocks on your CLI</p>
					<div className="space-y-2">
						{[
							{ cmd: 'gw admin policies', desc: 'Manage guardrails from terminal' },
							{ cmd: 'gw admin pause', desc: 'Emergency pause from anywhere' },
							{ cmd: 'gw admin resume', desc: 'Resume a paused account' },
						].map(({ cmd, desc }) => (
							<div key={cmd} className="flex items-start gap-2.5">
								<code className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
									{cmd}
								</code>
								<span className="text-[11px] text-text-dim">{desc}</span>
							</div>
						))}
					</div>
					<p className="text-[10px] text-text-dim leading-relaxed pt-1 border-t border-border">
						Your CLI can already sign transactions. This transfers the <strong>recovery key</strong>{' '}
						for admin operations.
					</p>
				</div>

				{/* How it works */}
				<div className="rounded-xl border border-border bg-background p-4 space-y-3">
					<p className="text-[12px] font-semibold text-text">How it works</p>
					<div className="space-y-2.5">
						<div className="flex items-start gap-2.5">
							<span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground">
								1
							</span>
							<p className="text-[11px] text-text-muted">
								Verify with <strong>Touch ID</strong>
							</p>
						</div>
						<div className="flex items-start gap-2.5">
							<span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground">
								2
							</span>
							<p className="text-[11px] text-text-muted">
								We generate a <strong>6-word transfer code</strong>
							</p>
						</div>
						<div className="flex items-start gap-2.5">
							<span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground">
								3
							</span>
							<p className="text-[11px] text-text-muted">
								Enter the code on your CLI with{' '}
								<code className="rounded bg-surface-hover px-1 py-0.5 font-mono text-[10px]">
									gw receive
								</code>
							</p>
						</div>
					</div>
				</div>

				<Button className="w-full h-11" onClick={startExport}>
					<Fingerprint className="h-3.5 w-3.5" />
					Continue with Touch ID
				</Button>
			</div>
		);
	}

	if (step === 'auth') {
		return (
			<div className="flex flex-col items-center gap-3 py-8">
				<Fingerprint className="h-6 w-6 text-accent animate-pulse" />
				<div className="text-center">
					<p className="text-[13px] font-medium text-text">Waiting for verification</p>
					<p className="text-[11px] text-text-dim mt-1">
						Complete the passkey prompt in your browser.
					</p>
				</div>
			</div>
		);
	}

	if (step === 'encrypting') {
		return (
			<div className="flex flex-col items-center gap-3 py-8">
				<Loader2 className="h-5 w-5 animate-spin text-text-dim" />
				<p className="text-[12px] text-text-dim">Preparing transfer...</p>
			</div>
		);
	}

	if (step === 'show-words') {
		return (
			<div className="space-y-5">
				{/* Warning */}
				<div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
					<div className="flex items-start gap-2.5">
						<AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
						<p className="text-[11px] text-text-muted leading-relaxed">
							These words grant access to your signing key. Do not share them. They expire in{' '}
							<strong>10 minutes</strong>.
						</p>
					</div>
				</div>

				{/* Transfer code display — 3x2 grid */}
				<div className="rounded-xl border border-border bg-background p-4">
					<p className="text-[10px] font-medium uppercase tracking-wider text-text-dim mb-3">
						Transfer Code
					</p>
					<div className="grid grid-cols-3 gap-2">
						{words.map((word, i) => (
							<div
								key={`export-${i}`}
								className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
							>
								<span className="text-[10px] font-mono text-text-dim/50 select-none">{i + 1}.</span>
								<span className="text-[14px] font-mono font-semibold text-text select-all">
									{word}
								</span>
							</div>
						))}
					</div>

					{/* Copy button */}
					<button
						type="button"
						onClick={handleCopy}
						className={cn(
							'mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-[11px] font-medium transition-colors',
							copied
								? 'border-success/40 bg-success/[0.04] text-success'
								: 'text-text-muted hover:bg-surface-hover',
						)}
					>
						{copied ? (
							<>
								<Check className="h-3 w-3" />
								Copied
							</>
						) : (
							<>
								<Copy className="h-3 w-3" />
								Copy all words
							</>
						)}
					</button>
				</div>

				{/* CLI instruction */}
				<div className="rounded-lg border border-border bg-background px-4 py-3">
					<div className="flex items-start gap-2.5">
						<Terminal className="h-3.5 w-3.5 text-text-muted shrink-0 mt-0.5" />
						<div>
							<p className="text-[12px] font-medium text-text">Run this in your terminal</p>
							<code className="mt-1.5 block rounded bg-surface-hover px-2.5 py-1.5 font-mono text-[11px] text-text select-all">
								gw receive
							</code>
							<p className="text-[10px] text-text-dim mt-1.5">
								Then enter these 6 words when prompted.
							</p>
						</div>
					</div>
				</div>

				<Button variant="outline" className="w-full" onClick={onDone}>
					Done
				</Button>
			</div>
		);
	}

	// error step
	const isPermissionError = error?.includes('permission');
	return (
		<div className="flex flex-col items-center gap-4 py-6">
			<div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
				<AlertTriangle className="h-5 w-5 text-danger" />
			</div>
			<div className="text-center">
				<p className="text-[14px] font-semibold text-text">
					{isPermissionError ? 'Not authorized' : 'Export failed'}
				</p>
				<p className="text-[12px] text-text-dim mt-1 leading-relaxed max-w-[300px]">{error}</p>
			</div>
			<div className="flex gap-2 mt-2">
				<Button variant="outline" onClick={onDone}>
					Close
				</Button>
				{!isPermissionError && (
					<Button
						onClick={() => {
							setError(null);
							setStep('confirm');
						}}
					>
						Try Again
					</Button>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

export function ShareTransferDialog({
	open,
	onOpenChange,
	signerId,
	signerName,
	initialMode,
}: ShareTransferDialogProps) {
	const [mode, setMode] = useState<Mode>(initialMode ?? 'select');

	// Reset mode when dialog opens/closes, apply initialMode when opening
	useEffect(() => {
		if (open) {
			setMode(initialMode ?? 'select');
		} else {
			// Small delay to allow close animation
			const timer = setTimeout(() => setMode(initialMode ?? 'select'), 200);
			return () => clearTimeout(timer);
		}
	}, [open, initialMode]);

	const handleDone = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);

	const title =
		mode === 'select'
			? 'Transfer Recovery Key'
			: mode === 'import'
				? 'Enable Dashboard Signing'
				: 'Enable CLI Admin Access';

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="border-border bg-surface sm:max-w-[420px] p-0 overflow-hidden">
				{/* Header */}
				<div className="border-b border-border bg-surface px-6 pt-6 pb-4">
					<DialogHeader>
						<DialogTitle className="text-text text-[16px]">{title}</DialogTitle>
						{mode === 'select' && (
							<p className="text-[12px] text-text-dim mt-1">
								Your recovery key enables signing and admin access on another device.
							</p>
						)}
					</DialogHeader>
				</div>

				{/* Content */}
				<div className="px-6 pb-6 pt-4">
					{mode === 'select' && (
						<div className="space-y-3">
							{/* Import option */}
							<button
								type="button"
								onClick={() => setMode('import')}
								className="flex w-full items-start gap-3.5 rounded-xl border border-border bg-background px-4 py-3.5 text-left transition-colors hover:bg-surface-hover group"
							>
								<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/[0.06] group-hover:bg-accent/10 transition-colors">
									<ArrowDownToLine className="h-4 w-4 text-accent" />
								</div>
								<div className="flex-1 min-w-0">
									<p className="text-[13px] font-semibold text-text">CLI → Dashboard</p>
									<p className="text-[11px] text-text-dim mt-0.5 leading-relaxed">
										Enable dashboard signing and visual guardrail management.
									</p>
								</div>
							</button>

							{/* Export option */}
							<button
								type="button"
								onClick={() => setMode('export')}
								className="flex w-full items-start gap-3.5 rounded-xl border border-border bg-background px-4 py-3.5 text-left transition-colors hover:bg-surface-hover group"
							>
								<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/[0.06] group-hover:bg-accent/10 transition-colors">
									<ArrowUpFromLine className="h-4 w-4 text-accent" />
								</div>
								<div className="flex-1 min-w-0">
									<p className="text-[13px] font-semibold text-text">Dashboard → CLI</p>
									<p className="text-[11px] text-text-dim mt-0.5 leading-relaxed">
										Enable CLI admin access: manage guardrails, sign without the server.
									</p>
								</div>
							</button>

							{/* Trust footer */}
							<div className="flex items-center justify-center gap-1.5 pt-2 text-[10px] text-text-dim">
								<Shield className="h-3 w-3" />
								<span>Your full key is never reconstructed during transfer</span>
							</div>
						</div>
					)}

					{mode === 'import' && (
						<ImportFlow signerId={signerId} signerName={signerName} onDone={handleDone} />
					)}

					{mode === 'export' && <ExportFlow signerId={signerId} onDone={handleDone} />}
				</div>
			</DialogContent>
		</Dialog>
	);
}
