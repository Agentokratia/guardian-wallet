import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAddToken } from '@/hooks/use-tokens';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus } from 'lucide-react';
import { useState } from 'react';

interface AddTokenDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	signerId: string;
	chainId: number;
}

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function AddTokenDialog({ open, onOpenChange, signerId, chainId }: AddTokenDialogProps) {
	const { toast } = useToast();
	const addToken = useAddToken();
	const [address, setAddress] = useState('');
	const [symbol, setSymbol] = useState('');
	const [name, setName] = useState('');
	const [decimals, setDecimals] = useState('18');

	const isValidAddress = ETH_ADDRESS_RE.test(address);
	const canSubmit = isValidAddress && symbol.trim().length > 0 && name.trim().length > 0;

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!canSubmit) return;

		addToken.mutate(
			{
				signerId,
				chainId,
				address: address.trim(),
				symbol: symbol.trim().toUpperCase(),
				name: name.trim(),
				decimals: Number(decimals) || 18,
			},
			{
				onSuccess: () => {
					toast({ title: 'Token added', description: `${symbol.toUpperCase()} is now tracked.` });
					setAddress('');
					setSymbol('');
					setName('');
					setDecimals('18');
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
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="border-border bg-surface sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="text-text">Add Token</DialogTitle>
					<DialogDescription className="text-text-muted">
						Track an ERC-20 token for this account.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-1.5">
						<label htmlFor="token-address" className="text-xs font-medium text-text-muted">
							Token Address
						</label>
						<Input
							id="token-address"
							placeholder="0x..."
							value={address}
							onChange={(e) => setAddress(e.target.value)}
							className="font-mono text-sm"
						/>
						{address.length > 0 && !isValidAddress && (
							<p className="text-xs text-danger">Enter a valid ERC-20 contract address</p>
						)}
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1.5">
							<label htmlFor="token-symbol" className="text-xs font-medium text-text-muted">
								Symbol
							</label>
							<Input
								id="token-symbol"
								placeholder="e.g. WETH"
								value={symbol}
								onChange={(e) => setSymbol(e.target.value)}
								maxLength={10}
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
							/>
						</div>
					</div>
					<div className="space-y-1.5">
						<label htmlFor="token-name" className="text-xs font-medium text-text-muted">
							Token Name
						</label>
						<Input
							id="token-name"
							placeholder="e.g. Wrapped Ether"
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>
					<div className="flex justify-end gap-2 pt-2">
						<Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={!canSubmit || addToken.isPending}>
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
