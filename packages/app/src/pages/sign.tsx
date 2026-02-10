import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useMutation } from '@tanstack/react-query';
import {
	ArrowLeft,
	ArrowUpRight,
	ChevronDown,
	Loader2,
	Lock,
	Send,
	Shield,
	Wallet,
	Zap,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { parseEther } from 'viem';
import { useAccount, useSignMessage } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { useSigner } from '@/hooks/use-signer';
import { useTokenBalances } from '@/hooks/use-token-balances';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api-client';
import { browserInteractiveSign } from '@/lib/browser-signer';
import { getChainId, getExplorerTxUrl } from '@/lib/chains';
import { formatTokenBalance } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { decryptUserShare, getSignMessage } from '@/lib/user-share-store';

const ETH_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

interface SimulationResult {
	estimatedGas: string;
	gasCostEth: string;
	success: boolean;
	error?: string;
}

interface SignResult {
	txHash: string;
	signature: { r: string; s: string; v: number };
}

interface EncryptedShareResponse {
	iv: string;
	ciphertext: string;
	salt: string;
}

/* ========================================================================== */
/*  Token color helpers                                                        */
/* ========================================================================== */

const TOKEN_COLORS: Record<string, string> = {
	ETH: 'bg-blue-500/15 text-blue-600',
	USDC: 'bg-green-500/15 text-green-600',
	USDT: 'bg-emerald-500/15 text-emerald-600',
	WETH: 'bg-indigo-500/15 text-indigo-600',
	DAI: 'bg-amber-500/15 text-amber-600',
};

function getTokenColor(symbol: string): string {
	return TOKEN_COLORS[symbol.toUpperCase()] ?? 'bg-stone-200/60 text-stone-600';
}

/* ========================================================================== */
/*  Signing status messages                                                    */
/* ========================================================================== */

const SIGNING_STEPS = [
	{ key: 'fetch', label: 'Retrieving encrypted share', icon: Lock },
	{ key: 'wallet', label: 'Requesting wallet signature', icon: Wallet },
	{ key: 'decrypt', label: 'Decrypting share locally', icon: Shield },
	{ key: 'signing', label: 'Threshold signing in progress', icon: Zap },
] as const;

type SigningStepKey = (typeof SIGNING_STEPS)[number]['key'];

function SigningProgress({ currentStep }: { currentStep: SigningStepKey }) {
	const stepIndex = SIGNING_STEPS.findIndex((s) => s.key === currentStep);
	return (
		<div className="space-y-2">
			{SIGNING_STEPS.map((step, i) => {
				const isActive = i === stepIndex;
				const isComplete = i < stepIndex;
				const Icon = step.icon;
				return (
					<div
						key={step.key}
						className={cn(
							'flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all text-sm',
							isActive && 'bg-accent/[0.06] text-text',
							isComplete && 'text-success',
							!isActive && !isComplete && 'text-text-dim/40',
						)}
					>
						<div className="shrink-0">
							{isActive ? (
								<Loader2 className="h-4 w-4 animate-spin text-accent" />
							) : isComplete ? (
								<div className="flex h-4 w-4 items-center justify-center rounded-full bg-success text-white">
									<svg className="h-2.5 w-2.5" viewBox="0 0 10 10" fill="none">
										<path d="M2 5L4 7L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
									</svg>
								</div>
							) : (
								<Icon className="h-4 w-4" />
							)}
						</div>
						<span className="font-medium">{step.label}</span>
					</div>
				);
			})}
		</div>
	);
}

/* ========================================================================== */
/*  Main Page                                                                  */
/* ========================================================================== */

export function SignPage() {
	const { id } = useParams<{ id: string }>();
	const [searchParams] = useSearchParams();
	const { data: signer, isLoading: signerLoading } = useSigner(id ?? '');
	const { toast } = useToast();
	const { isConnected, chain } = useAccount();
	const { signMessageAsync, isPending: isWalletSigning } = useSignMessage();

	// Get tokens for balance display
	const { data: tokenData } = useTokenBalances(id ?? '', chain?.id);

	// Pre-select token from URL params (when clicking Send on a token row)
	const preselectedToken = searchParams.get('token') ?? 'ETH';

	// Form state
	const [toAddress, setToAddress] = useState('');
	const [value, setValue] = useState('');
	const [selectedToken, setSelectedToken] = useState(preselectedToken);
	const [calldata, setCalldata] = useState('');
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [network, setNetwork] = useState('base-sepolia');
	const [simulation, setSimulation] = useState<SimulationResult | null>(null);
	const [txResult, setTxResult] = useState<SignResult | null>(null);
	const [signingStep, setSigningStep] = useState<SigningStepKey | null>(null);

	// Validation (inline, no state for "touched" — just validate on blur)
	const [addressTouched, setAddressTouched] = useState(false);
	const [amountTouched, setAmountTouched] = useState(false);

	const addressError = addressTouched && toAddress && !ETH_ADDRESS_REGEX.test(toAddress)
		? 'Enter a valid Ethereum address'
		: null;
	const amountError = amountTouched && value && (Number.isNaN(Number(value)) || Number(value) <= 0)
		? 'Enter a valid amount'
		: null;

	const isFormValid =
		ETH_ADDRESS_REGEX.test(toAddress) &&
		value.length > 0 &&
		!Number.isNaN(Number(value)) &&
		Number(value) > 0 &&
		isConnected;

	// Token balance for selected token
	const selectedTokenData = tokenData?.tokens.find(
		(t) => t.symbol.toUpperCase() === selectedToken.toUpperCase(),
	);
	const tokenBalance = selectedTokenData
		? formatTokenBalance(selectedTokenData.balance, selectedTokenData.decimals)
		: '---';

	const handleMax = () => {
		if (selectedTokenData) {
			setValue(formatTokenBalance(selectedTokenData.balance, selectedTokenData.decimals));
			setAmountTouched(true);
		}
	};

	// Simulate mutation
	const simulateMutation = useMutation({
		mutationFn: () =>
			api.post<SimulationResult>(`/signers/${id}/simulate`, {
				to: toAddress,
				value,
				data: calldata || undefined,
				network,
			}),
		onSuccess: (result) => setSimulation(result),
		onError: () => toast({ title: 'Simulation failed', variant: 'destructive' }),
	});

	// Interactive sign mutation
	const signMutation = useMutation({
		mutationFn: async (): Promise<SignResult> => {
			if (!id) throw new Error('No signer ID');

			setSigningStep('fetch');
			const encrypted = await api.get<EncryptedShareResponse>(`/signers/${id}/user-share`);

			setSigningStep('wallet');
			const signature = await signMessageAsync({ message: getSignMessage(id) });

			setSigningStep('decrypt');
			const userShareBytes = await decryptUserShare(encrypted, signature);

			setSigningStep('signing');
			const chainId = getChainId(network);
			const valueWei = value ? parseEther(value).toString() : undefined;

			const result = await browserInteractiveSign(
				userShareBytes,
				id,
				{
					to: toAddress,
					value: valueWei,
					data: calldata || undefined,
					chainId,
				},
			);

			setSigningStep(null);
			return result;
		},
		onSuccess: (result) => {
			setTxResult(result);
			toast({ title: 'Transaction sent successfully' });
		},
		onError: (err: unknown) => {
			setSigningStep(null);
			const message = err instanceof Error ? err.message : 'Transaction failed';
			toast({ title: 'Transaction failed', description: message, variant: 'destructive' });
		},
	});

	if (signerLoading) {
		return (
			<div className="flex items-center justify-center py-20">
				<Loader2 className="h-5 w-5 animate-spin text-text-muted" />
			</div>
		);
	}

	if (!signer) {
		return <div className="py-20 text-center text-text-muted">Account not found.</div>;
	}

	const isSigning = signMutation.isPending || isWalletSigning;

	/* ====================================================================== */
	/*  SUCCESS STATE                                                          */
	/* ====================================================================== */
	if (txResult) {
		return (
			<div className="mx-auto max-w-md">
				<div className="text-center py-12">
					{/* Success circle */}
					<div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10 mb-5">
						<div className="flex h-10 w-10 items-center justify-center rounded-full bg-success text-white">
							<svg className="h-5 w-5" viewBox="0 0 20 20" fill="none">
								<path d="M5 10L9 14L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
						</div>
					</div>

					<h2 className="text-xl font-bold text-text">Transaction Sent</h2>
					<p className="text-sm text-text-dim mt-1.5">
						Your transaction has been signed and broadcast to the network.
					</p>

					{/* Tx details card */}
					<div className="mt-6 rounded-xl border border-border bg-surface p-4 text-left">
						<div className="space-y-3">
							<div className="flex items-center justify-between text-sm">
								<span className="text-text-dim">Amount</span>
								<span className="font-semibold text-text">{value} {selectedToken}</span>
							</div>
							<div className="flex items-center justify-between text-sm">
								<span className="text-text-dim">To</span>
								<code className="font-mono text-[12px] text-text">
									{toAddress.slice(0, 8)}...{toAddress.slice(-6)}
								</code>
							</div>
							<div className="border-t border-border pt-3">
								<div className="flex items-center justify-between text-sm">
									<span className="text-text-dim">Transaction</span>
									<a
										href={getExplorerTxUrl(network, txResult.txHash)}
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex items-center gap-1 text-accent hover:text-accent-hover font-mono text-[12px] transition-colors"
									>
										{txResult.txHash.slice(0, 10)}...{txResult.txHash.slice(-6)}
										<ArrowUpRight className="h-3 w-3" />
									</a>
								</div>
							</div>
						</div>
					</div>

					{/* Actions */}
					<div className="mt-6 flex gap-3">
						<Button variant="outline" className="flex-1" asChild>
							<Link to={`/signers/${id}`}>Back to Account</Link>
						</Button>
						<Button
							className="flex-1"
							onClick={() => {
								setTxResult(null);
								setSimulation(null);
								setToAddress('');
								setValue('');
								setCalldata('');
								setAddressTouched(false);
								setAmountTouched(false);
							}}
						>
							Send Another
						</Button>
					</div>

					{/* Security footer */}
					<div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-text-dim">
						<Lock className="h-3 w-3" />
						<span>Signed with threshold cryptography. Private key never existed.</span>
					</div>
				</div>
			</div>
		);
	}

	/* ====================================================================== */
	/*  SIGNING IN PROGRESS STATE                                              */
	/* ====================================================================== */
	if (isSigning && signingStep) {
		return (
			<div className="mx-auto max-w-md">
				{/* Back */}
				<Link
					to={`/signers/${id}`}
					className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-text-dim hover:text-text-muted transition-colors"
				>
					<ArrowLeft className="h-3.5 w-3.5" />
					{signer.name}
				</Link>

				{/* Signing card */}
				<div className="rounded-2xl border border-border bg-surface overflow-hidden">
					<div className="bg-gradient-to-br from-[#18181B] to-[#27272A] px-6 py-5 text-center">
						<h1 className="text-lg font-bold text-white">Signing Transaction</h1>
						<p className="text-[13px] text-white/40 mt-1">
							{value} {selectedToken} to {toAddress.slice(0, 8)}...{toAddress.slice(-6)}
						</p>
					</div>

					<div className="p-5">
						<SigningProgress currentStep={signingStep} />

						<div className="mt-5 rounded-lg bg-accent/[0.04] border border-accent/10 px-4 py-3">
							<p className="text-[12px] text-text-dim leading-relaxed">
								<Shield className="h-3 w-3 inline mr-1.5 text-accent" />
								Your private key is never reconstructed. Two shares sign independently using threshold cryptography.
							</p>
						</div>
					</div>
				</div>
			</div>
		);
	}

	/* ====================================================================== */
	/*  SEND FORM                                                              */
	/* ====================================================================== */
	return (
		<div className="mx-auto max-w-md">
			{/* Back */}
			<Link
				to={`/signers/${id}`}
				className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-text-dim hover:text-text-muted transition-colors"
			>
				<ArrowLeft className="h-3.5 w-3.5" />
				{signer.name}
			</Link>

			{/* Send card */}
			<div className="rounded-2xl border border-border bg-surface overflow-hidden">
				{/* Dark header */}
				<div className="bg-gradient-to-br from-[#18181B] to-[#27272A] px-6 py-5">
					<div className="flex items-center justify-between">
						<div>
							<h1 className="text-lg font-bold text-white">Send</h1>
							<p className="text-[12px] text-white/35 mt-0.5 font-mono">
								{signer.ethAddress.slice(0, 10)}...{signer.ethAddress.slice(-6)}
							</p>
						</div>
						{!isConnected ? (
							<ConnectButton />
						) : (
							<div className="flex items-center gap-1.5 text-[11px] text-white/40">
								<div className="h-1.5 w-1.5 rounded-full bg-success" />
								Wallet connected
							</div>
						)}
					</div>
				</div>

				<div className="p-5 space-y-5">
					{/* ── Asset selector ── */}
					<div>
						<label className="text-[11px] font-medium uppercase tracking-wider text-text-dim mb-2 block">
							Asset
						</label>
						<button
							type="button"
							className="flex w-full items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 transition-colors hover:bg-surface-hover text-left"
							onClick={() => {
								// For now, ETH only. Token selector could expand later.
							}}
						>
							<div className={cn(
								'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold',
								getTokenColor(selectedToken),
							)}>
								{selectedToken.slice(0, 2)}
							</div>
							<div className="flex-1 min-w-0">
								<div className="text-sm font-semibold text-text">{selectedToken}</div>
								<div className="text-[12px] text-text-dim">
									Balance: {tokenBalance} {selectedToken}
								</div>
							</div>
							<ChevronDown className="h-4 w-4 text-text-dim shrink-0" />
						</button>
					</div>

					{/* ── Recipient ── */}
					<div>
						<label htmlFor="send-to" className="text-[11px] font-medium uppercase tracking-wider text-text-dim mb-2 block">
							Recipient
						</label>
						<Input
							id="send-to"
							className={cn(
								'font-mono text-[13px] h-12',
								addressError && 'border-danger focus-visible:ring-danger',
							)}
							placeholder="0x..."
							value={toAddress}
							onChange={(e) => setToAddress(e.target.value)}
							onBlur={() => setAddressTouched(true)}
						/>
						{addressError && (
							<p className="text-[11px] text-danger mt-1.5">{addressError}</p>
						)}
					</div>

					{/* ── Amount ── */}
					<div>
						<div className="flex items-center justify-between mb-2">
							<label htmlFor="send-amount" className="text-[11px] font-medium uppercase tracking-wider text-text-dim">
								Amount
							</label>
							<button
								type="button"
								onClick={handleMax}
								className="text-[11px] font-semibold text-accent hover:text-accent-hover transition-colors uppercase tracking-wider"
							>
								Max
							</button>
						</div>
						<div className="relative">
							<Input
								id="send-amount"
								type="number"
								className={cn(
									'font-mono text-[13px] h-12 pr-16',
									amountError && 'border-danger focus-visible:ring-danger',
								)}
								placeholder="0.0"
								step="0.0001"
								min="0"
								value={value}
								onChange={(e) => setValue(e.target.value)}
								onBlur={() => setAmountTouched(true)}
							/>
							<div className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-text-dim">
								{selectedToken}
							</div>
						</div>
						{amountError && (
							<p className="text-[11px] text-danger mt-1.5">{amountError}</p>
						)}
					</div>

					{/* ── Network ── */}
					<div>
						<label htmlFor="send-network" className="text-[11px] font-medium uppercase tracking-wider text-text-dim mb-2 block">
							Network
						</label>
						<Select value={network} onValueChange={setNetwork}>
							<SelectTrigger className="h-11">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="mainnet">Ethereum Mainnet</SelectItem>
								<SelectItem value="sepolia">Sepolia Testnet</SelectItem>
								<SelectItem value="base">Base</SelectItem>
								<SelectItem value="base-sepolia">Base Sepolia</SelectItem>
								<SelectItem value="arbitrum">Arbitrum One</SelectItem>
								<SelectItem value="arbitrum-sepolia">Arbitrum Sepolia</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{/* ── Advanced (calldata) ── */}
					<div>
						<button
							type="button"
							onClick={() => setShowAdvanced(!showAdvanced)}
							className="text-[11px] font-medium text-text-dim hover:text-text transition-colors flex items-center gap-1"
						>
							<ChevronDown className={cn('h-3 w-3 transition-transform', showAdvanced && 'rotate-180')} />
							Advanced options
						</button>
						{showAdvanced && (
							<div className="mt-3">
								<label htmlFor="send-calldata" className="text-[11px] font-medium uppercase tracking-wider text-text-dim mb-2 block">
									Calldata
								</label>
								<Input
									id="send-calldata"
									className="font-mono text-[12px]"
									placeholder="0x..."
									value={calldata}
									onChange={(e) => setCalldata(e.target.value)}
								/>
								<p className="text-[10px] text-text-dim mt-1">Raw hex data for contract interactions</p>
							</div>
						)}
					</div>

					{/* ── Simulation result ── */}
					{simulation && (
						<div className="rounded-xl border border-border bg-background p-4 space-y-2.5">
							<div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-dim">
								<Zap className="h-3 w-3" />
								Gas Estimate
							</div>
							<div className="flex items-center justify-between text-sm">
								<span className="text-text-dim">Estimated gas</span>
								<span className="font-mono text-text">{simulation.estimatedGas}</span>
							</div>
							<div className="flex items-center justify-between text-sm">
								<span className="text-text-dim">Gas cost</span>
								<span className="font-mono text-text">{simulation.gasCostEth} ETH</span>
							</div>
							<div className="flex items-center justify-between text-sm">
								<span className="text-text-dim">Status</span>
								<span className={cn(
									'text-xs font-semibold px-2 py-0.5 rounded-full',
									simulation.success
										? 'bg-success/10 text-success'
										: 'bg-danger/10 text-danger',
								)}>
									{simulation.success ? 'Likely success' : 'May revert'}
								</span>
							</div>
							{simulation.error && (
								<p className="text-[11px] text-danger font-mono mt-1">{simulation.error}</p>
							)}
						</div>
					)}

					{/* ── Actions ── */}
					<div className="space-y-2.5 pt-1">
						{/* Simulate button (secondary) */}
						<Button
							variant="outline"
							className="w-full h-11"
							onClick={() => simulateMutation.mutate()}
							disabled={!ETH_ADDRESS_REGEX.test(toAddress) || simulateMutation.isPending}
						>
							{simulateMutation.isPending ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Zap className="h-4 w-4" />
							)}
							{simulateMutation.isPending ? 'Simulating...' : 'Preview Transaction'}
						</Button>

						{/* Send button (primary) */}
						<Button
							className="w-full h-12 text-[15px] font-semibold"
							onClick={() => signMutation.mutate()}
							disabled={!isFormValid || signMutation.isPending}
						>
							{signMutation.isPending ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Send className="h-4 w-4" />
							)}
							{signMutation.isPending ? 'Signing...' : `Send ${selectedToken}`}
						</Button>

						{!isConnected && (
							<p className="text-[11px] text-center text-text-dim">
								Connect your wallet above to enable sending
							</p>
						)}
					</div>
				</div>
			</div>

			{/* Trust footer */}
			<div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-text-dim">
				<Lock className="h-3 w-3" />
				<span>Protected by 2-of-3 threshold cryptography</span>
			</div>
		</div>
	);
}
