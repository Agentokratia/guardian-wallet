import { DKGProgress, type DKGState } from '@/components/dkg-progress';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { downloadFile } from '@/lib/download';
import { Input } from '@/components/ui/input';
import { Mono } from '@/components/ui/mono';
import { Pill } from '@/components/ui/pill';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCreateSigner, useDKGFinalize, useDKGInit } from '@/hooks/use-dkg';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api-client';
import { encryptUserShare, getSignMessage } from '@/lib/user-share-store';
import { cn } from '@/lib/utils';
import {
	AlertTriangle,
	Bot,
	Check,
	ChevronLeft,
	ChevronRight,
	Code,
	Copy,
	Cpu,
	Download,
	Globe,
	Key,
	Loader2,
	Shield,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount, useSignMessage } from 'wagmi';

const TOTAL_STEPS = 4;

const stepLabels = [
	'Account',
	'Setup',
	'Credentials',
	'Integration',
] as const;

const signerTypes = [
	{
		value: 'ai_agent',
		label: 'AI Agent',
		icon: <Bot className="h-5 w-5" />,
		desc: 'Autonomous on-chain ops',
	},
	{
		value: 'deploy_script',
		label: 'Deploy Script',
		icon: <Code className="h-5 w-5" />,
		desc: 'CI/CD contract deploys',
	},
	{
		value: 'backend_service',
		label: 'Backend Service',
		icon: <Globe className="h-5 w-5" />,
		desc: 'Server-side signing',
	},
	{
		value: 'team_member',
		label: 'Team Member',
		icon: <Shield className="h-5 w-5" />,
		desc: 'Personal dev wallet',
	},
	{
		value: 'trading_bot',
		label: 'Trading Bot',
		icon: <Cpu className="h-5 w-5" />,
		desc: 'Automated DEX trading',
	},
	{
		value: 'custom',
		label: 'Custom',
		icon: <Key className="h-5 w-5" />,
		desc: 'No default policies',
	},
] as const;

interface WizardState {
	name: string;
	description: string;
	type: string;
	// DKG results
	sessionId: string;
	signerId: string;
	ethAddress: string;
	apiKey: string;
	shareData: string;
	userShareData: string;
	// Credentials
	userShareSaved: boolean;
	encryptedBackup: string;
	confirmed: boolean;
}

const initialState: WizardState = {
	name: '',
	description: '',
	type: 'ai_agent',
	sessionId: '',
	signerId: '',
	ethAddress: '',
	apiKey: '',
	shareData: '',
	userShareData: '',
	userShareSaved: false,
	encryptedBackup: '',
	confirmed: false,
};

function ProgressBar({ step }: { step: number }) {
	return (
		<div className="mb-8">
			<div className="flex items-center justify-between mb-2">
				{stepLabels.map((label, i) => (
					<div
						key={label}
						className={cn(
							'flex items-center gap-1.5 text-xs font-medium transition-colors',
							i < step ? 'text-success' : i === step ? 'text-accent' : 'text-text-dim',
						)}
					>
						<div
							className={cn(
								'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
								i < step
									? 'bg-success text-white'
									: i === step
										? 'bg-accent text-white'
										: 'bg-surface-hover text-text-dim',
							)}
						>
							{i < step ? <Check className="h-3 w-3" /> : i + 1}
						</div>
						<span className="hidden sm:inline">{label}</span>
					</div>
				))}
			</div>
			<div className="h-1 w-full overflow-hidden rounded-full bg-surface-hover">
				<div
					className="h-full rounded-full bg-accent transition-all duration-500"
					style={{ width: `${(step / (TOTAL_STEPS - 1)) * 100}%` }}
				/>
			</div>
		</div>
	);
}

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

// Step 1: Name & Chain
function StepNameChain({
	state,
	onChange,
}: {
	state: WizardState;
	onChange: (partial: Partial<WizardState>) => void;
}) {
	return (
		<div className="space-y-6">
			{/* Name */}
			<div>
				<label htmlFor="signer-name" className="mb-1.5 block text-sm font-medium text-text">
					Account Name
				</label>
				<Input
					id="signer-name"
					placeholder="e.g., trading-bot-1"
					value={state.name}
					onChange={(e) => onChange({ name: e.target.value })}
					className="bg-surface"
				/>
				<Mono size="xs" className="mt-1 text-text-dim">
					A unique name for this account
				</Mono>
			</div>

			{/* Description */}
			<div>
				<label htmlFor="signer-description" className="mb-1.5 block text-sm font-medium text-text">
					Description
				</label>
				<Input
					id="signer-description"
					placeholder="Optional description"
					value={state.description}
					onChange={(e) => onChange({ description: e.target.value })}
					className="bg-surface"
				/>
			</div>

			{/* Signer type */}
			<div>
				<label htmlFor="signer-type" className="mb-2 block text-sm font-medium text-text">
					Account Type
				</label>
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
					{signerTypes.map((t) => (
						<button
							key={t.value}
							type="button"
							onClick={() => onChange({ type: t.value })}
							className={cn(
								'flex flex-col items-center gap-2 rounded-lg border px-4 py-4 transition-all',
								state.type === t.value
									? 'border-accent bg-accent-muted'
									: 'border-border bg-surface hover:border-border-light hover:bg-surface-hover',
							)}
						>
							<div
								className={cn(
									'text-lg',
									state.type === t.value ? 'text-accent' : 'text-text-muted',
								)}
							>
								{t.icon}
							</div>
							<div className="text-center">
								<div
									className={cn(
										'text-sm font-medium',
										state.type === t.value ? 'text-accent' : 'text-text',
									)}
								>
									{t.label}
								</div>
								<Mono size="xs" className="text-text-dim">
									{t.desc}
								</Mono>
							</div>
						</button>
					))}
				</div>
			</div>

			{/* Key type (chain determines curve) */}
			<div>
				<label className="mb-2 block text-sm font-medium text-text">Key Type</label>
				<div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
					<div className="flex items-center gap-3 rounded-lg border border-accent bg-accent-muted px-4 py-3">
						<Mono size="xs" className="text-accent font-bold">{'\u27E0'}</Mono>
						<div>
							<div className="text-sm font-medium text-accent">ECDSA secp256k1</div>
							<Mono size="xs" className="text-text-dim">Ethereum, Base, Arbitrum, Polygon...</Mono>
						</div>
					</div>
					<div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 opacity-40">
						<Mono size="xs" className="text-text-dim font-bold">{'\u20BF'}</Mono>
						<div>
							<div className="text-sm font-medium text-text-dim">Schnorr</div>
							<Mono size="xs" className="text-text-dim">Bitcoin — soon</Mono>
						</div>
					</div>
					<div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 opacity-40">
						<Mono size="xs" className="text-text-dim font-bold">{'\u25CE'}</Mono>
						<div>
							<div className="text-sm font-medium text-text-dim">Ed25519</div>
							<Mono size="xs" className="text-text-dim">Solana — soon</Mono>
						</div>
					</div>
				</div>
				<Mono size="xs" className="mt-1.5 text-text-dim">
					Same key works on any EVM chain. Network is chosen at transaction time.
				</Mono>
			</div>
		</div>
	);
}

// Step 2: DKG
function StepDKG({
	state,
	onChange,
}: {
	state: WizardState;
	onChange: (partial: Partial<WizardState>) => void;
}) {
	const [dkgState, setDKGState] = useState<DKGState>('ready');
	const [currentRound, setCurrentRound] = useState(1);
	const [errorMessage, setErrorMessage] = useState('');

	const { isConnected, address } = useAccount();
	const { signMessageAsync } = useSignMessage();

	const createSigner = useCreateSigner();
	const dkgInit = useDKGInit();
	const dkgFinalize = useDKGFinalize();

	const startDKG = useCallback(async () => {
		setDKGState('running');
		setCurrentRound(1);
		setErrorMessage('');

		try {
			// Step 1: Create signer record (gets API key)
			const { signer, apiKey } = await createSigner.mutateAsync({
				name: state.name,
				type: state.type,
				scheme: 'cggmp21',
				description: state.description || undefined,
			});

			const signerId = signer.id;
			onChange({ signerId, apiKey });

			// Step 2: Init DKG (creates 3 server-side sessions, round 1)
			setCurrentRound(2);
			const initResult = await dkgInit.mutateAsync({ signerId });
			const sessionId = initResult.sessionId;
			onChange({ sessionId });

			// Step 3: Finalize DKG (runs rounds 2-5 server-side, returns shares)
			setCurrentRound(3);
			const finalResult = await dkgFinalize.mutateAsync({
				sessionId,
				signerId,
			});

			onChange({
				ethAddress: finalResult.ethAddress,
				shareData: finalResult.signerShare,
				userShareData: finalResult.userShare,
			});

			// Step 4: Automatically encrypt and store user share if wallet is connected
			if (isConnected && address && finalResult.userShare) {
				setCurrentRound(4);
				const signature = await signMessageAsync({ message: getSignMessage(signerId) });
				const shareBytes = Uint8Array.from(atob(finalResult.userShare), (c) => c.charCodeAt(0));
				const encrypted = await encryptUserShare(shareBytes, signature);

				const payload = {
					walletAddress: address,
					iv: encrypted.iv,
					ciphertext: encrypted.ciphertext,
					salt: encrypted.salt,
				};
				await api.post(`/signers/${signerId}/user-share`, payload);
				onChange({
					userShareSaved: true,
					encryptedBackup: JSON.stringify(payload),
				});
			}

			setDKGState('complete');
		} catch (err: unknown) {
			setDKGState('error');
			const message = err instanceof Error ? err.message : 'Account creation failed';
			setErrorMessage(message);
		}
	}, [
		state.name,
		state.type,
		state.description,
		createSigner,
		dkgInit,
		dkgFinalize,
		onChange,
		isConnected,
		address,
		signMessageAsync,
	]);

	return (
		<div className="space-y-6">
			<Card className="border-border bg-surface">
				<CardContent className="p-6">
					<h3 className="mb-1 text-base font-semibold text-text">Create Account</h3>
					<p className="text-sm text-text-muted">
						Your signing key is split into 3 parts so no single device ever holds the full key. This takes a few seconds.
					</p>
				</CardContent>
			</Card>

			<DKGProgress
				state={dkgState}
				currentRound={currentRound}
				ethAddress={state.ethAddress}
				errorMessage={errorMessage}
			/>

			{dkgState === 'ready' && (
				<Button onClick={startDKG} className="w-full">
					Create Account
				</Button>
			)}

			{dkgState === 'error' && (
				<Button onClick={startDKG} variant="outline" className="w-full">
					Retry
				</Button>
			)}
		</div>
	);
}

// Step 3: Credentials — API Key + API Secret + Backup Key
function StepCredentials({
	state,
	onChange,
}: {
	state: WizardState;
	onChange: (partial: Partial<WizardState>) => void;
}) {
	const [savingBackup, setSavingBackup] = useState(false);
	const { toast } = useToast();
	const { isConnected, address } = useAccount();
	const { signMessageAsync, isPending: isSigning } = useSignMessage();

	const handleEncryptAndStore = async () => {
		if (!state.userShareData || !state.signerId || !isConnected || !address) return;
		setSavingBackup(true);
		try {
			const signature = await signMessageAsync({ message: getSignMessage(state.signerId) });
			const shareBytes = Uint8Array.from(atob(state.userShareData), (c) => c.charCodeAt(0));
			const encrypted = await encryptUserShare(shareBytes, signature);

			const payload = {
				walletAddress: address,
				iv: encrypted.iv,
				ciphertext: encrypted.ciphertext,
				salt: encrypted.salt,
			};
			await api.post(`/signers/${state.signerId}/user-share`, payload);

			onChange({
				userShareSaved: true,
				encryptedBackup: JSON.stringify(payload),
			});
			toast({ title: 'Backup key encrypted and stored' });
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'Failed to encrypt backup key';
			toast({ title: 'Error', description: message, variant: 'destructive' });
		} finally {
			setSavingBackup(false);
		}
	};

	return (
		<div className="space-y-4">
			{/* API Key */}
			<Card className="border-border bg-surface">
				<CardContent className="p-4 space-y-2">
					<div className="flex items-center justify-between">
						<Mono size="xs" className="font-semibold text-text">API Key</Mono>
						<Pill color="warning">Save this -- shown only once</Pill>
					</div>
					<div className="flex items-center gap-2 rounded-md border border-border bg-[#1a1a1a] px-3 py-2">
						<code className="flex-1 font-mono text-xs text-[#e4e4e7] break-all">
							{state.apiKey || 'gw_live_xxxxxxxxxxxxxxxxxxxxx'}
						</code>
						<CopyButton text={state.apiKey} />
					</div>
					<Mono size="xs" className="text-text-dim">
						Use in the <code className="text-[#818cf8]">x-api-key</code> header or <code className="text-[#818cf8]">GW_API_KEY</code> env var.
					</Mono>
				</CardContent>
			</Card>

			{/* API Secret */}
			<Card className="border-border bg-surface">
				<CardContent className="p-4 space-y-3">
					<div className="flex items-center justify-between">
						<Mono size="xs" className="font-semibold text-text">API Secret</Mono>
						<Pill color="warning">Save this -- shown only once</Pill>
					</div>
					<Button
						size="sm"
						variant="outline"
						onClick={() => {
							if (!state.shareData) return;
							const blob = new Blob([state.shareData], { type: 'text/plain' });
							downloadFile(blob, `${state.name || 'signer'}.secret`);
						}}
						disabled={!state.shareData}
						className="w-full"
					>
						<Download className="h-3.5 w-3.5" />
						Download Secret File
					</Button>
					<Mono size="xs" className="text-text-dim">
						Save this file securely. You'll need it to configure the CLI or SDK.
					</Mono>
				</CardContent>
			</Card>

			{/* Backup Key */}
			<Card className="border-border bg-surface">
				<CardContent className="p-4 space-y-2">
					<div className="flex items-center justify-between">
						<Mono size="xs" className="font-semibold text-text">Backup Key</Mono>
						<Pill color="default">Recovery</Pill>
					</div>
					<p className="text-sm text-text-muted">
						Encrypted with your connected wallet. Store in your password manager. Needed for recovery if the server is unavailable.
					</p>

					{state.userShareSaved ? (
						<div className="space-y-2">
							<div className="flex items-center gap-2 rounded-md border border-success/20 bg-success-muted px-3 py-2">
								<Check className="h-4 w-4 text-success" />
								<span className="text-sm text-success">Backup key encrypted and stored</span>
							</div>
							<Button
								variant="outline"
								className="w-full"
								onClick={() => {
									if (!state.encryptedBackup) return;
									const blob = new Blob([state.encryptedBackup], { type: 'application/json' });
									downloadFile(blob, `${state.name || 'signer'}.guardian-backup.json`);
								}}
								disabled={!state.encryptedBackup}
							>
								<Download className="h-4 w-4" />
								Download {state.name || 'signer'}.guardian-backup.json
							</Button>
						</div>
					) : (
						<Button
							variant="outline"
							className="w-full"
							onClick={handleEncryptAndStore}
							disabled={!state.userShareData || !isConnected || savingBackup || isSigning}
						>
							{savingBackup || isSigning ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Shield className="h-4 w-4" />
							)}
							{isSigning
								? 'Sign with wallet...'
								: savingBackup
									? 'Encrypting...'
									: 'Encrypt & Download Backup'}
						</Button>
					)}

					{!isConnected && (
						<Mono size="xs" className="text-warning">
							Wallet not connected. Connect via the login page to encrypt backup.
						</Mono>
					)}
				</CardContent>
			</Card>

			{/* Confirmation */}
			<Card className="border-warning/20 bg-warning-muted">
				<CardContent className="p-4">
					<div className="flex items-start gap-3">
						<AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
						<div className="flex-1">
							<p className="text-sm text-text">
								I have securely saved my API key and API secret. Both are shown only once
								and cannot be recovered. The backup key download is recommended in case the
								server becomes unavailable.
							</p>
							<div className="mt-3 flex items-center gap-2">
								<Switch
									checked={state.confirmed}
									onCheckedChange={(checked) => onChange({ confirmed: checked })}
								/>
								<span className="text-sm font-medium text-text">I confirm</span>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

// Step 5: Integration
function StepIntegration({ state }: { state: WizardState }) {
	const signerName = state.name || 'my-signer';

	const cliSnippet = `# Install the CLI
npm install -g @agentokratia/guardian-cli

# Save the .secret file to ~/.gw/
mv ~\/Downloads/${signerName}.secret ~/.gw/

# Configure (enter file path when prompted)
gw init

# Or use env vars
export GW_API_KEY="${state.apiKey || 'gw_live_...'}"
export GW_API_SECRET_FILE="~/.gw/${signerName}.secret"

# Check status
gw status

# Send a transaction
gw send 0x... 0.01`;

	const sdkSnippet = `import { readFileSync } from 'fs';
import { ThresholdSigner } from '@agentokratia/guardian-signer';
import { DKLs23Scheme } from '@agentokratia/guardian-schemes';

const signer = await ThresholdSigner.fromSecret({
  serverUrl: '${window.location.origin}',
  apiKey: process.env.GW_API_KEY,
  apiSecret: readFileSync(process.env.GW_API_SECRET_FILE, 'utf-8'),
  scheme: new DKLs23Scheme(),
});

// Use with viem
const account = signer.toAccount();`;

	const pythonSnippet = `from guardian import Signer
from pathlib import Path

signer = Signer(
    server_url="${window.location.origin}",
    api_key=os.environ["GW_API_KEY"],
    api_secret=Path(os.environ["GW_API_SECRET_FILE"]).read_text(),
)

tx_hash = signer.send_transaction(to="0x...", value=0.01)`;

	return (
		<div className="space-y-6">
			<div>
				<h3 className="text-base font-semibold text-text">Integration Guide</h3>
				<p className="mt-1 text-sm text-text-muted">
					Your account is ready. Use one of these methods to start signing transactions.
				</p>
			</div>

			{state.ethAddress && (
				<div className="rounded-lg border border-success/20 bg-success-muted p-4">
					<Mono size="xs" className="text-text-dim">
						Account Address
					</Mono>
					<div className="mt-1 font-mono text-sm text-success">{state.ethAddress}</div>
				</div>
			)}

			<Tabs defaultValue="cli">
				<TabsList className="w-full">
					<TabsTrigger value="cli" className="flex-1">
						CLI
					</TabsTrigger>
					<TabsTrigger value="sdk" className="flex-1">
						TypeScript SDK
					</TabsTrigger>
					<TabsTrigger value="python" className="flex-1">
						Python SDK
					</TabsTrigger>
				</TabsList>
				<TabsContent value="cli">
					<pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-[#1a1a1a] p-4 font-mono text-xs text-[#a1a1aa] leading-relaxed">
						{cliSnippet}
					</pre>
				</TabsContent>
				<TabsContent value="sdk">
					<pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-[#1a1a1a] p-4 font-mono text-xs text-[#a1a1aa] leading-relaxed">
						{sdkSnippet}
					</pre>
				</TabsContent>
				<TabsContent value="python">
					<pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-[#1a1a1a] p-4 font-mono text-xs text-[#a1a1aa] leading-relaxed">
						{pythonSnippet}
					</pre>
				</TabsContent>
			</Tabs>
		</div>
	);
}

// Main wizard component
export function CreateSignerPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const [step, setStep] = useState(0);
	const [state, setState] = useState<WizardState>(initialState);

	const onChange = useCallback((partial: Partial<WizardState>) => {
		setState((prev) => ({ ...prev, ...partial }));
	}, []);

	const canProceed = (): boolean => {
		switch (step) {
			case 0: // Account
				return state.name.trim().length > 0;
			case 1: // Setup (DKG)
				return state.ethAddress.length > 0;
			case 2: // Credentials
				return state.confirmed;
			case 3: // Integration
				return true;
			default:
				return false;
		}
	};

	const handleNext = () => {
		if (step < TOTAL_STEPS - 1) {
			setStep(step + 1);
		} else {
			// Final step -- invalidate signers cache and navigate to list
			queryClient.invalidateQueries({ queryKey: ['signers'] });
			toast({
				title: 'Account created',
				description: `${state.name} is ready to use.`,
			});
			navigate('/signers');
		}
	};

	const handleBack = () => {
		if (step > 0) setStep(step - 1);
	};

	return (
		<>
			<Header title="Create Account" backHref="/signers" backLabel="Back to Accounts" />

			<ProgressBar step={step} />

			{/* Step content */}
			<div className="mx-auto max-w-2xl">
				{step === 0 && <StepNameChain state={state} onChange={onChange} />}
				{step === 1 && <StepDKG state={state} onChange={onChange} />}
				{step === 2 && <StepCredentials state={state} onChange={onChange} />}
				{step === 3 && <StepIntegration state={state} />}

				{/* Navigation */}
				<div className="mt-8 flex items-center justify-between border-t border-border pt-6">
					<Button variant="ghost" onClick={handleBack} disabled={step === 0}>
						<ChevronLeft className="h-4 w-4" />
						Back
					</Button>
					<Mono size="xs" className="text-text-dim">
						Step {step + 1} of {TOTAL_STEPS}
					</Mono>
					<Button onClick={handleNext} disabled={!canProceed()}>
						{step === TOTAL_STEPS - 1 ? 'Finish' : 'Next'}
						{step < TOTAL_STEPS - 1 && <ChevronRight className="h-4 w-4" />}
					</Button>
				</div>
			</div>
		</>
	);
}
