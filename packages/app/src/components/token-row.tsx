import { Mono } from '@/components/ui/mono';
import type { TokenBalance } from '@/hooks/use-token-balances';
import { formatTokenBalance } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { ArrowUpRight, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';

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

interface TokenRowProps {
	token: TokenBalance;
	signerId?: string;
	onRemove?: () => void;
	className?: string;
}

export function TokenRow({ token, signerId, onRemove, className }: TokenRowProps) {
	const formatted = formatTokenBalance(token.balance, token.decimals);
	const colorClass = getTokenColor(token.symbol);

	return (
		<div
			className={cn(
				'group flex items-center justify-between px-4 py-3.5 transition-colors hover:bg-surface-hover',
				className,
			)}
		>
			<div className="flex items-center gap-3.5">
				<div
					className={cn(
						'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold',
						colorClass,
					)}
				>
					{token.symbol.slice(0, 2)}
				</div>
				<div>
					<div className="text-sm font-semibold text-text">{token.symbol}</div>
					<div className="text-[12px] text-text-dim">{token.name}</div>
				</div>
			</div>
			<div className="flex items-center gap-2">
				<div className="text-right">
					<div className="text-sm font-semibold tabular-nums text-text">
						{formatted} {token.symbol}
					</div>
				</div>
				{/* Send button — appears on hover */}
				{signerId && (
					<Link
						to={`/signers/${signerId}/sign?token=${token.symbol}`}
						className="flex h-8 w-8 items-center justify-center rounded-full opacity-0 group-hover:opacity-100 bg-accent text-accent-foreground transition-all duration-150 hover:scale-110"
						title={`Send ${token.symbol}`}
					>
						<ArrowUpRight className="h-3.5 w-3.5" />
					</Link>
				)}
				{onRemove && token.source === 'custom' && (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onRemove();
						}}
						className="flex h-8 w-8 items-center justify-center rounded-full opacity-0 group-hover:opacity-100 text-text-dim hover:text-danger hover:bg-danger-muted transition-all duration-150"
						aria-label={`Remove ${token.symbol}`}
					>
						<Trash2 className="h-3.5 w-3.5" />
					</button>
				)}
			</div>
		</div>
	);
}
