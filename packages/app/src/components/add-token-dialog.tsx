import { NetworkIcon } from '@/components/network-icon';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useNetworks } from '@/hooks/use-networks';
import { useAddToken } from '@/hooks/use-tokens';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, Loader2, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPublicClient, defineChain, erc20Abi, getAddress, http, type Address } from 'viem';

function getPublicClient(chainId: number, rpcUrl: string) {
	return createPublicClient({
		chain: defineChain({ id: chainId, name: '', nativeCurrency: { name: '', symbol: '', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } }),
		transport: http(rpcUrl),
	});
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

interface AddTokenDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	signerId: string;
	chainId: number;
}

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function AddTokenDialog({ open, onOpenChange, signerId, chainId: defaultChainId }: AddTokenDialogProps) {
	const { toast } = useToast();
	const addToken = useAddToken();
	const { data: networks } = useNetworks();

	const [address, setAddress] = useState('');
	const [symbol, setSymbol] = useState('');
	const [name, setName] = useState('');
	const [decimals, setDecimals] = useState('18');
	const [selectedChainId, setSelectedChainId] = useState<number>(defaultChainId);
	const [networkOpen, setNetworkOpen] = useState(false);

	// Auto-fetch state
	const [fetching, setFetching] = useState(false);
	const [fetchError, setFetchError] = useState<string | null>(null);
	const [autoFilled, setAutoFilled] = useState(false);
	const fetchRef = useRef(0); // prevent stale fetches

	const enabledNetworks = useMemo(
		() => (networks ?? []).filter((n) => n.enabled),
		[networks],
	);

	const selectedNetwork = enabledNetworks.find((n) => n.chainId === selectedChainId);

	const isValidAddress = ETH_ADDRESS_RE.test(address);
	const canSubmit = isValidAddress && symbol.trim().length > 0 && name.trim().length > 0;

	const resetForm = useCallback(() => {
		setAddress('');
		setSymbol('');
		setName('');
		setDecimals('18');
		setSelectedChainId(defaultChainId);
		setNetworkOpen(false);
		setFetchError(null);
		setAutoFilled(false);
		fetchRef.current++;
	}, [defaultChainId]);

	/* ---------------------------------------------------------------------- */
	/*  Auto-fetch token metadata when address + network are valid             */
	/* ---------------------------------------------------------------------- */
	useEffect(() => {
		if (!isValidAddress || !selectedNetwork) {
			setFetchError(null);
			setAutoFilled(false);
			return;
		}

		const id = ++fetchRef.current;
		const client = getPublicClient(selectedChainId, selectedNetwork.rpcUrl);

		let cancelled = false;
		setFetching(true);
		setFetchError(null);
		setAutoFilled(false);

		(async () => {
			try {
				const tokenAddress = getAddress(address.trim()) as Address;

				const [tokenSymbol, tokenName, tokenDecimals] = await Promise.all([
					client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'symbol' }),
					client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'name' }),
					client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'decimals' }),
				]);

				if (cancelled || fetchRef.current !== id) return;

				setSymbol(String(tokenSymbol));
				setName(String(tokenName));
				setDecimals(String(tokenDecimals));
				setAutoFilled(true);
				setFetchError(null);
			} catch {
				if (cancelled || fetchRef.current !== id) return;
				setFetchError('Not a valid ERC-20 on this network');
				setAutoFilled(false);
			} finally {
				if (!cancelled && fetchRef.current === id) {
					setFetching(false);
				}
			}
		})();

		return () => { cancelled = true; };
	}, [address, selectedChainId, isValidAddress, selectedNetwork]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!canSubmit) return;

		addToken.mutate(
			{
				signerId,
				chainId: selectedChainId,
				address: address.trim(),
				symbol: symbol.trim().toUpperCase(),
				name: name.trim(),
				decimals: Number(decimals) || 18,
			},
			{
				onSuccess: () => {
					const netLabel = selectedNetwork?.displayName ?? '';
					toast({
						title: 'Token added',
						description: `${symbol.toUpperCase()} on ${netLabel} is now tracked.`,
					});
					resetForm();
					onOpenChange(false);
				},
				onError: (err) => {
					toast({
						title: 'Failed to add token',
						description: err instanceof Error ? err.message : 'Unknown error',
						variant: 'destructive',
					});
				},
			},
		);
	};

	return (
		<Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
			<DialogContent className="border-border bg-surface sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="text-text">Add Token</DialogTitle>
					<DialogDescription className="text-text-muted">
						Paste a contract address — we'll fetch the details automatically.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4">
					{/* Network picker */}
					<div className="space-y-1.5">
						<label className="text-xs font-medium text-text-muted">
							Network
						</label>
						<div className="relative">
							<button
								type="button"
								onClick={() => setNetworkOpen(!networkOpen)}
								className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors hover:bg-surface-hover"
							>
								<div className="flex items-center gap-2">
									{selectedNetwork && (
										<NetworkIcon network={selectedNetwork.name} size="sm" />
									)}
									<span className="text-text">
										{selectedNetwork?.displayName ?? 'Select network'}
									</span>
									{selectedNetwork?.isTestnet && (
										<span className="text-[9px] px-1 py-0.5 rounded bg-surface-hover text-text-dim font-medium">
											testnet
										</span>
									)}
								</div>
								<ChevronDown className={cn(
									'h-3.5 w-3.5 text-text-dim transition-transform',
									networkOpen && 'rotate-180',
								)} />
							</button>

							{networkOpen && (
								<div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-border bg-surface shadow-lg overflow-hidden">
									{enabledNetworks.map((net) => (
										<button
											key={net.chainId}
											type="button"
											onClick={() => {
												setSelectedChainId(net.chainId);
												setNetworkOpen(false);
											}}
											className={cn(
												'flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-surface-hover',
												net.chainId === selectedChainId && 'bg-accent-muted',
											)}
										>
											<NetworkIcon network={net.name} size="sm" />
											<span className="text-text">{net.displayName}</span>
											{net.isTestnet && (
												<span className="text-[9px] px-1 py-0.5 rounded bg-surface-hover text-text-dim font-medium">
													testnet
												</span>
											)}
										</button>
									))}
								</div>
							)}
						</div>
					</div>

					{/* Token address */}
					<div className="space-y-1.5">
						<label htmlFor="token-address" className="text-xs font-medium text-text-muted">
							Contract Address
						</label>
						<div className="relative">
							<Input
								id="token-address"
								placeholder="0x..."
								value={address}
								onChange={(e) => {
									setAddress(e.target.value);
									setAutoFilled(false);
								}}
								className="font-mono text-sm pr-8"
							/>
							{fetching && (
								<Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-text-dim" />
							)}
							{autoFilled && !fetching && (
								<Check className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-success" />
							)}
						</div>
						{address.length > 0 && !isValidAddress && (
							<p className="text-xs text-danger">Enter a valid ERC-20 contract address</p>
						)}
						{fetchError && (
							<p className="text-xs text-warning">{fetchError}</p>
						)}
						{autoFilled && (
							<p className="text-xs text-success">Token detected — fields auto-filled</p>
						)}
					</div>

					{/* Symbol + Decimals — auto-filled but editable */}
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1.5">
							<label htmlFor="token-symbol" className="text-xs font-medium text-text-muted">
								Symbol
							</label>
							<Input
								id="token-symbol"
								placeholder={fetching ? 'Loading...' : 'e.g. WETH'}
								value={symbol}
								onChange={(e) => setSymbol(e.target.value)}
								maxLength={10}
								disabled={fetching}
							/>
						</div>
						<div className="space-y-1.5">
							<label htmlFor="token-decimals" className="text-xs font-medium text-text-muted">
								Decimals
							</label>
							<Input
								id="token-decimals"
								type="number"
								min={0}
								max={18}
								value={decimals}
								onChange={(e) => setDecimals(e.target.value)}
								disabled={fetching}
							/>
						</div>
					</div>

					{/* Token name */}
					<div className="space-y-1.5">
						<label htmlFor="token-name" className="text-xs font-medium text-text-muted">
							Token Name
						</label>
						<Input
							id="token-name"
							placeholder={fetching ? 'Loading...' : 'e.g. Wrapped Ether'}
							value={name}
							onChange={(e) => setName(e.target.value)}
							disabled={fetching}
						/>
					</div>

					{/* Actions */}
					<div className="flex justify-end gap-2 pt-2">
						<Button type="button" variant="ghost" onClick={() => { resetForm(); onOpenChange(false); }}>
							Cancel
						</Button>
						<Button type="submit" disabled={!canSubmit || addToken.isPending || fetching}>
							{addToken.isPending ? (
								<>
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
									Adding...
								</>
							) : (
								<>
									<Plus className="h-3.5 w-3.5" />
									Add Token
								</>
							)}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
