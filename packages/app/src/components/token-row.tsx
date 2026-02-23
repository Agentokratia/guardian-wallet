import { TokenLogo } from '@/components/token-logo';
import type { TokenBalance } from '@/hooks/use-token-balances';
import { formatTokenBalance } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { ArrowUpRight, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';

interface TokenRowProps {
	token: TokenBalance;
	signerId?: string;
	onRemove?: () => void;
	className?: string;
}

export function TokenRow({ token, signerId, onRemove, className }: TokenRowProps) {
	const formatted = formatTokenBalance(token.balance, token.decimals);
	const isZero = BigInt(token.balance) === 0n;

	return (
		<div
			className={cn(
				'group flex items-center justify-between px-4 py-3 transition-colors hover:bg-surface-hover',
				className,
			)}
		>
			<div className="flex items-center gap-3 min-w-0">
				<TokenLogo symbol={token.symbol} logoUrl={token.logoUrl} size="md" />
				<div className="min-w-0">
					<div className="text-sm font-semibold text-text">{token.symbol}</div>
					<div className="text-[12px] text-text-dim truncate">{token.name}</div>
				</div>
			</div>
			<div className="flex items-center gap-2 shrink-0 pl-3">
				<div className="text-right">
					<span
						className={cn(
							'text-sm font-semibold tabular-nums font-mono',
							isZero ? 'text-text-dim' : 'text-text',
						)}
					>
						{formatted}
					</span>
					<span className={cn('ml-1 text-xs', isZero ? 'text-text-dim/60' : 'text-text-muted')}>
						{token.symbol}
					</span>
				</div>
				{signerId && (
					<Link
						to={`/signers/${signerId}/sign?token=${token.symbol}`}
						className="flex h-7 w-7 items-center justify-center rounded-full opacity-0 group-hover:opacity-100 focus-visible:opacity-100 bg-accent text-accent-foreground transition-[opacity,transform] duration-150 hover:scale-110"
						aria-label={`Send ${token.symbol}`}
					>
						<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
					</Link>
				)}
				{onRemove && token.source === 'custom' && (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onRemove();
						}}
						className="flex h-7 w-7 items-center justify-center rounded-full opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-text-dim hover:text-danger hover:bg-danger-muted transition-[opacity,color,background-color] duration-150"
						aria-label={`Remove ${token.symbol}`}
					>
						<Trash2 className="h-3.5 w-3.5" />
					</button>
				)}
			</div>
		</div>
	);
}
