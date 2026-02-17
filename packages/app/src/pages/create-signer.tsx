import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { downloadFile } from '@/lib/download';
import { Input } from '@/components/ui/input';
import { Mono } from '@/components/ui/mono';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCreateSigner, useDKGFinalize, useDKGInit } from '@/hooks/use-dkg';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api-client';
import { encryptUserShare } from '@/lib/user-share-store';
import { cn } from '@/lib/utils';
import { wipePRF } from '@agentokratia/guardian-auth/browser';
import { useAuth } from '@/hooks/use-auth';
import {
	AlertTriangle,
	ArrowRight,
	Bot,
	Check,
	CheckCircle2,
	ChevronDown,
	Code,
	Copy,
	Cpu,
	Download,
	Globe,
	Key,
	Loader2,
	Lock,
	Shield,
	Terminal,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

type Phase = 'input' | 'creating' | 'done' | 'error';

interface CreationResult {
	signerId: string;
	ethAddress: string;
	apiKey: string;
	shareData: string;
	backupStored: boolean;
	backupPayload: string;
}

interface CreationProgress {
	step: number;
	label: string;
}

const PROGRESS_STEPS = [
	'Creating account...',
	'Generating keys...',
	'Securing backup...',
	'Done',
] as const;

/* -------------------------------------------------------------------------- */
/*  Account type options                                                       */
/* -------------------------------------------------------------------------- */

const ACCOUNT_TYPES = [
	{ value: 'ai_agent', label: 'AI Agent', icon: Bot },
	{ value: 'deploy_script', label: 'Deploy Script', icon: Code },
	{ value: 'backend_service', label: 'Backend', icon: Globe },
	{ value: 'team_member', label: 'Team Member', icon: Shield },
	{ value: 'trading_bot', label: 'Trading Bot', icon: Cpu },
	{ value: 'custom', label: 'Custom', icon: Key },
] as const;

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

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
			className={cn('shrink-0 text-text-dim hover:text-text transition-colors', className)}
			aria-label="Copy"
		>
			{copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
		</button>
	);
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */

export function CreateSignerPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { isAuthenticated, address, refreshPRF } = useAuth();

	const createSigner = useCreateSigner();
	const dkgInit = useDKGInit();
	const dkgFinalize = useDKGFinalize();

	// Input state
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [accountType, setAccountType] = useState('ai_agent');
	const [typeOpen, setTypeOpen] = useState(false);

	// Flow state
	const [phase, setPhase] = useState<Phase>('input');
	const [progress, setProgress] = useState<CreationProgress>({ step: 0, label: PROGRESS_STEPS[0] });
	const [result, setResult] = useState<CreationResult | null>(null);
	const [errorMessage, setErrorMessage] = useState('');
	const [secretDownloaded, setSecretDownloaded] = useState(false);

	// Prevent leaving without downloading
	const needsDownloadRef = useRef(false);

	useEffect(() => {
		const handler = (e: BeforeUnloadEvent) => {
			if (needsDownloadRef.current) {
				e.preventDefault();
			}
		};
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	}, []);

	/* -------------------------------------------------------------------- */
	/*  The single create action — does everything atomically                */
	/* -------------------------------------------------------------------- */

	const handleCreate = useCallback(async () => {
		if (!name.trim()) return;

		setPhase('creating');
		setProgress({ step: 0, label: PROGRESS_STEPS[0] });
		setErrorMessage('');

		try {
			// 1. Create signer record
			const { signer, apiKey } = await createSigner.mutateAsync({
				name: name.trim(),
				type: accountType,
				scheme: 'cggmp24',
				description: description.trim() || undefined,
			});

			// 2. DKG — generate keys
			setProgress({ step: 1, label: PROGRESS_STEPS[1] });
			const initResult = await dkgInit.mutateAsync({ signerId: signer.id });

			const finalResult = await dkgFinalize.mutateAsync({
				sessionId: initResult.sessionId,
				signerId: signer.id,
			});

			// 3. Auto-encrypt & store backup
			setProgress({ step: 2, label: PROGRESS_STEPS[2] });
			let backupStored = false;

			let backupPayloadJson = '';
			if (finalResult.userShare && isAuthenticated) {
				let prfOutput: Uint8Array | null = null;
				try {
					console.log('[create-signer] Getting PRF for share encryption...');
					prfOutput = await refreshPRF();
					console.log('[create-signer] Got PRF, length:', prfOutput.length);
				} catch (err) {
					console.warn('[create-signer] refreshPRF failed — backup will be skipped:', err);
				}

				if (prfOutput) {
					try {
						const prfHex = Array.from(prfOutput.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
						console.log('[create-signer] PRF fingerprint (first 8 bytes):', prfHex);
						const shareBytes = Uint8Array.from(atob(finalResult.userShare), (c) => c.charCodeAt(0));
						const encrypted = await encryptUserShare(shareBytes, prfOutput);

						const payload = {
							walletAddress: address,
							iv: encrypted.iv,
							ciphertext: encrypted.ciphertext,
							salt: encrypted.salt,
						};
						await api.post(`/signers/${signer.id}/user-share`, payload);
						backupStored = true;
						backupPayloadJson = JSON.stringify(payload);
						console.log('[create-signer] User share encrypted and stored successfully');
					} finally {
						wipePRF(prfOutput);
					}
				}
			}

			// 4. Done
			setProgress({ step: 3, label: PROGRESS_STEPS[3] });
			setResult({
				signerId: signer.id,
				ethAddress: finalResult.ethAddress,
				apiKey,
				shareData: finalResult.signerShare,
				backupStored,
				backupPayload: backupPayloadJson,
			});
			needsDownloadRef.current = true;
			setPhase('done');
		} catch (err: unknown) {
			setPhase('error');
			setErrorMessage(err instanceof Error ? err.message : 'Account creation failed');
		}
	}, [
		name,
		description,
		accountType,
		createSigner,
		dkgInit,
		dkgFinalize,
		isAuthenticated,
		address,
		refreshPRF,
	]);

	const handleDownloadSecret = () => {
		if (!result?.shareData) return;
		const blob = new Blob([result.shareData], { type: 'text/plain' });
		downloadFile(blob, `${name || 'signer'}.secret`);
		setSecretDownloaded(true);
		needsDownloadRef.current = false;
	};

	const handleFinish = () => {
		queryClient.invalidateQueries({ queryKey: ['signers'] });
		toast({ title: 'Account created', description: `${name} is ready to use.` });
		navigate(`/signers/${result?.signerId}`);
	};

	const selectedType = ACCOUNT_TYPES.find((t) => t.value === accountType) ?? ACCOUNT_TYPES[0];

	/* -------------------------------------------------------------------- */
	/*  Render                                                                */
	/* -------------------------------------------------------------------- */

	return (
		<>
			<Header title="Create Account" backHref="/signers" backLabel="Back to Accounts" />

			<div className={cn(
				'mx-auto space-y-6',
				phase === 'done' ? 'max-w-5xl' : 'max-w-lg',
			)}>
				{/* -------------------------------------------------------- */}
				{/*  Phase: Input                                             */}
				{/* -------------------------------------------------------- */}
				{phase === 'input' && (
					<>
						<div className="space-y-4">
							{/* Name */}
							<div>
								<label htmlFor="signer-name" className="mb-1.5 block text-sm font-medium text-text">
									Account Name
								</label>
								<Input
									id="signer-name"
									placeholder="e.g., trading-bot-1"
									value={name}
									onChange={(e) => setName(e.target.value)}
									className="bg-surface"
									autoFocus
								/>
								<p className="mt-1 text-[11px] text-text-dim">
									A short identifier for this signer. Use lowercase and hyphens for SDK compatibility.
								</p>
							</div>

							{/* Description — optional */}
							<div>
								<label htmlFor="signer-desc" className="mb-1.5 block text-sm font-medium text-text">
									Description <span className="text-text-dim font-normal">optional</span>
								</label>
								<Input
									id="signer-desc"
									placeholder="What will this account do?"
									value={description}
									onChange={(e) => setDescription(e.target.value)}
									className="bg-surface"
								/>
							</div>

							{/* Type — compact dropdown */}
							<div>
								<label className="mb-1.5 block text-sm font-medium text-text">
									Type
								</label>
								<div className="relative">
									<button
										type="button"
										onClick={() => setTypeOpen(!typeOpen)}
										className="flex w-full items-center justify-between rounded-md border border-input bg-surface px-3 py-2 text-sm transition-colors hover:bg-surface-hover"
									>
										<div className="flex items-center gap-2">
											<selectedType.icon className="h-4 w-4 text-text-muted" />
											<span className="text-text">{selectedType.label}</span>
										</div>
										<ChevronDown className={cn(
											'h-3.5 w-3.5 text-text-dim transition-transform',
											typeOpen && 'rotate-180',
										)} />
									</button>

									{typeOpen && (
										<div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-border bg-surface shadow-lg overflow-hidden">
											{ACCOUNT_TYPES.map((t) => (
												<button
													key={t.value}
													type="button"
													onClick={() => { setAccountType(t.value); setTypeOpen(false); }}
													className={cn(
														'flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-surface-hover',
														t.value === accountType && 'bg-accent-muted',
													)}
												>
													<t.icon className="h-4 w-4 text-text-muted" />
													<span className="text-text">{t.label}</span>
												</button>
											))}
										</div>
									)}
								</div>
							</div>
						</div>

						<p className="text-[11px] text-text-dim text-center leading-relaxed">
							This will generate a 2-of-3 threshold key via distributed key generation (DKG).
							Your key share will be encrypted and ready to download.
						</p>

						<Button
							onClick={handleCreate}
							disabled={!name.trim() || !isAuthenticated}
							className="w-full"
							size="lg"
						>
							Create Account
						</Button>

						{!isAuthenticated && (
							<p className="text-center text-xs text-warning">
								You must be logged in to create an account.
							</p>
						)}
					</>
				)}

				{/* -------------------------------------------------------- */}
				{/*  Phase: Creating (progress)                               */}
				{/* -------------------------------------------------------- */}
				{phase === 'creating' && (
					<Card className="border-border bg-surface">
						<CardContent className="p-6 space-y-5">
							<div className="text-center">
								<Loader2 className="mx-auto h-8 w-8 animate-spin text-accent" />
								<p className="mt-3 text-sm font-medium text-text">{progress.label}</p>
								<p className="mt-1 text-xs text-text-dim">This takes a few seconds</p>
							</div>

							{/* Step indicators */}
							<div className="space-y-2.5">
								{PROGRESS_STEPS.slice(0, -1).map((label, i) => (
									<div key={label} className="flex items-center gap-2.5">
										<div className={cn(
											'flex h-5 w-5 items-center justify-center rounded-full text-[10px]',
											i < progress.step
												? 'bg-success text-white'
												: i === progress.step
													? 'bg-accent text-white'
													: 'bg-surface-hover text-text-dim',
										)}>
											{i < progress.step ? (
												<Check className="h-3 w-3" />
											) : i === progress.step ? (
												<Loader2 className="h-3 w-3 animate-spin" />
											) : (
												i + 1
											)}
										</div>
										<span className={cn(
											'text-sm',
											i < progress.step ? 'text-success' : i === progress.step ? 'text-text' : 'text-text-dim',
										)}>
											{label.replace('...', '')}
										</span>
									</div>
								))}
							</div>
						</CardContent>
					</Card>
				)}

				{/* -------------------------------------------------------- */}
				{/*  Phase: Error                                             */}
				{/* -------------------------------------------------------- */}
				{phase === 'error' && (
					<>
						<Card className="border-danger/30 bg-danger-muted">
							<CardContent className="p-4">
								<div className="flex items-start gap-3">
									<AlertTriangle className="h-5 w-5 text-danger shrink-0 mt-0.5" />
									<div>
										<p className="text-sm font-medium text-text">Account creation failed</p>
										<p className="mt-1 text-xs text-text-muted">{errorMessage}</p>
									</div>
								</div>
							</CardContent>
						</Card>
						<Button onClick={() => setPhase('input')} variant="outline" className="w-full">
							Try Again
						</Button>
					</>
				)}

				{/* -------------------------------------------------------- */}
				{/*  Phase: Done — 2-column credentials + integration          */}
				{/* -------------------------------------------------------- */}
				{phase === 'done' && result && (
					<>
						{/* Success banner — full width */}
						<div className="relative overflow-hidden rounded-2xl border border-success/20 bg-success-muted">
							<div
								className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_80%_30%,rgba(34,197,94,0.06)_0%,transparent_50%)]"
								aria-hidden="true"
							/>
							<div className="relative flex items-center gap-4 px-6 py-5">
								<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/10">
									<CheckCircle2 className="h-5 w-5 text-success" />
								</div>
								<div className="min-w-0 flex-1">
									<h2 className="text-base font-bold text-text">
										{name} is ready
									</h2>
									<div className="mt-1 flex items-center gap-2">
										<code className="font-mono text-[13px] text-success truncate">
											{result.ethAddress}
										</code>
										<CopyButton text={result.ethAddress} />
									</div>
								</div>
								<div className="hidden sm:flex items-center gap-1.5 text-[10px] text-text-dim">
									<Lock className="h-3 w-3" />
									<span>2-of-3 threshold key</span>
								</div>
							</div>
						</div>

						{/* 2-column layout */}
						<div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

							{/* LEFT — Credentials (3 cols) */}
							<div className="lg:col-span-3 space-y-4">
								<h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-text-dim">
									Your credentials
								</h3>

								{/* API Key */}
								<Card className="border-border bg-surface">
									<CardContent className="p-4 space-y-2.5">
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2">
												<Key className="h-3.5 w-3.5 text-text-dim" />
												<span className="text-[13px] font-semibold text-text">API Key</span>
											</div>
											<span className="text-[10px] font-medium text-warning px-1.5 py-0.5 rounded bg-warning/10">
												shown only once
											</span>
										</div>
										<div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
											<code className="flex-1 font-mono text-xs text-text break-all select-all">
												{result.apiKey}
											</code>
											<CopyButton text={result.apiKey} />
										</div>
										<p className="text-[11px] text-text-dim leading-relaxed">
											Pass as <code className="rounded bg-surface-hover px-1 py-0.5 text-accent font-medium">x-api-key</code> header
											or set <code className="rounded bg-surface-hover px-1 py-0.5 text-accent font-medium">GW_API_KEY</code> env var.
										</p>
									</CardContent>
								</Card>

								{/* Secret file download */}
								<Card className={cn(
									'border-border bg-surface transition-colors',
									!secretDownloaded && 'border-warning/40',
								)}>
									<CardContent className="p-4 space-y-2.5">
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2">
												<Shield className="h-3.5 w-3.5 text-text-dim" />
												<span className="text-[13px] font-semibold text-text">Secret File</span>
											</div>
											{secretDownloaded ? (
												<span className="text-[10px] font-medium text-success px-1.5 py-0.5 rounded bg-success/10 flex items-center gap-1">
													<Check className="h-3 w-3" /> saved
												</span>
											) : (
												<span className="text-[10px] font-medium text-warning px-1.5 py-0.5 rounded bg-warning/10">
													required
												</span>
											)}
										</div>
										<Button
											variant={secretDownloaded ? 'outline' : 'default'}
											className="w-full"
											onClick={handleDownloadSecret}
										>
											<Download className="h-3.5 w-3.5" />
											{secretDownloaded ? 'Download Again' : `Download ${name}.secret`}
										</Button>
										<p className="text-[11px] text-text-dim leading-relaxed">
											{secretDownloaded
												? 'Store securely. You can re-download it now, but not after leaving this page.'
												: 'This file contains your signing key share. Download it before continuing.'}
										</p>
									</CardContent>
								</Card>

								{/* Backup key */}
								<Card className={cn(
									'border-border bg-surface transition-colors',
									result.backupStored ? '' : 'border-warning/30',
								)}>
									<CardContent className="p-4 space-y-2.5">
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2">
												<Lock className="h-3.5 w-3.5 text-text-dim" />
												<span className="text-[13px] font-semibold text-text">Backup Key</span>
											</div>
											{result.backupStored ? (
												<span className="text-[10px] font-medium text-success px-1.5 py-0.5 rounded bg-success/10 flex items-center gap-1">
													<Check className="h-3 w-3" /> encrypted
												</span>
											) : (
												<span className="text-[10px] font-medium text-warning px-1.5 py-0.5 rounded bg-warning/10">
													failed
												</span>
											)}
										</div>
										{result.backupStored ? (
											<>
												<p className="text-[11px] text-text-dim leading-relaxed">
													Encrypted with your passkey and stored server-side. Keep a local copy for recovery.
												</p>
												<Button
													variant="outline"
													className="w-full"
													onClick={() => {
														if (!result.backupPayload) return;
														const blob = new Blob([result.backupPayload], { type: 'application/json' });
														downloadFile(blob, `${name || 'signer'}.guardian-backup.json`);
													}}
													disabled={!result.backupPayload}
												>
													<Download className="h-3.5 w-3.5" />
													Download backup
												</Button>
											</>
										) : (
											<div className="flex items-center gap-2">
												<AlertTriangle className="h-4 w-4 text-warning shrink-0" />
												<p className="text-[11px] text-warning leading-relaxed">
													Passkey encryption failed. Dashboard signing won't be available for this account.
												</p>
											</div>
										)}
									</CardContent>
								</Card>

								{/* Finish CTA */}
								<Button
									onClick={handleFinish}
									disabled={!secretDownloaded}
									className="w-full"
									size="lg"
								>
									{secretDownloaded ? (
										<>
											Go to Account
											<ArrowRight className="h-4 w-4" />
										</>
									) : (
										'Download secret file to continue'
									)}
								</Button>
							</div>

							{/* RIGHT — Integration Guide (2 cols) */}
							<div className="lg:col-span-2">
								<div className="lg:sticky lg:top-6 space-y-4">
									<h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-text-dim">
										Quick start
									</h3>

									<IntegrationGuide name={name} apiKey={result.apiKey} />

									{/* Next steps */}
									<div className="rounded-xl border border-border bg-surface p-4 space-y-3">
										<p className="text-[12px] font-semibold text-text">What's next?</p>
										<div className="space-y-2.5">
											<NextStep
												number={1}
												done={secretDownloaded}
												label="Download your secret file"
											/>
											<NextStep
												number={2}
												done={false}
												label="Set up your environment variables"
											/>
											<NextStep
												number={3}
												done={false}
												label="Send your first transaction"
											/>
										</div>
									</div>
								</div>
							</div>
						</div>
					</>
				)}
			</div>
		</>
	);
}

/* -------------------------------------------------------------------------- */
/*  Next-step checklist item                                                   */
/* -------------------------------------------------------------------------- */

function NextStep({ number, done, label }: { number: number; done: boolean; label: string }) {
	return (
		<div className="flex items-center gap-2.5">
			<div className={cn(
				'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
				done
					? 'bg-success/10 text-success'
					: 'bg-surface-hover text-text-dim',
			)}>
				{done ? <Check className="h-3 w-3" /> : number}
			</div>
			<span className={cn(
				'text-[12px]',
				done ? 'text-text-muted line-through' : 'text-text',
			)}>
				{label}
			</span>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/*  Integration guide — always visible in right column                         */
/* -------------------------------------------------------------------------- */

function IntegrationGuide({ name, apiKey }: { name: string; apiKey: string }) {
	const signerName = name || 'my-signer';

	const cliSnippet = `# 1. Move secret to config directory
mv ~/Downloads/${signerName}.secret ~/.gw/

# 2. Set environment variables
export GW_API_KEY="${apiKey || 'gw_live_...'}"
export GW_API_SECRET_FILE="~/.gw/${signerName}.secret"

# 3. Verify connection
gw status

# 4. Send your first transaction
gw send 0x... 0.01 ETH`;

	const sdkSnippet = `import { readFileSync } from 'fs';
import { ThresholdSigner } from '@agentokratia/guardian-signer';
import { CGGMP24Scheme } from '@agentokratia/guardian-schemes';

const signer = await ThresholdSigner.fromSecret({
  serverUrl: '${window.location.origin}',
  apiKey: process.env.GW_API_KEY,
  apiSecret: readFileSync(
    process.env.GW_API_SECRET_FILE, 'utf-8'
  ),
  scheme: new CGGMP24Scheme(),
});

// Drop-in viem account
const account = signer.toAccount();`;

	const pythonSnippet = `import os
from guardian import Signer
from pathlib import Path

signer = Signer(
    server_url="${window.location.origin}",
    api_key=os.environ["GW_API_KEY"],
    api_secret=Path(
        os.environ["GW_API_SECRET_FILE"]
    ).read_text(),
)

tx = signer.send_transaction(
    to="0x...", value=0.01
)`;

	return (
		<div className="rounded-xl border border-border bg-surface overflow-hidden">
			<div className="flex items-center gap-2 border-b border-border px-4 py-3">
				<Terminal className="h-3.5 w-3.5 text-text-dim" />
				<span className="text-[13px] font-semibold text-text">Integration Guide</span>
			</div>

			<div className="px-4 pb-4">
				<Tabs defaultValue="cli" className="mt-3">
					<TabsList className="w-full">
						<TabsTrigger value="cli" className="flex-1 text-[11px]">CLI</TabsTrigger>
						<TabsTrigger value="sdk" className="flex-1 text-[11px]">TypeScript</TabsTrigger>
						<TabsTrigger value="python" className="flex-1 text-[11px]">Python</TabsTrigger>
					</TabsList>
					<TabsContent value="cli">
						<pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-[11px] text-text-muted leading-relaxed">
							{cliSnippet}
						</pre>
					</TabsContent>
					<TabsContent value="sdk">
						<pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-[11px] text-text-muted leading-relaxed">
							{sdkSnippet}
						</pre>
					</TabsContent>
					<TabsContent value="python">
						<pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-[11px] text-text-muted leading-relaxed">
							{pythonSnippet}
						</pre>
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
}
