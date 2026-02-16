import type { TokenBalance } from '@/hooks/use-token-balances';
import { formatTokenBalance } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { ArrowUpRight, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

/* -------------------------------------------------------------------------- */
/*  Token logo URLs — well-known tokens get real logos from trusted CDNs       */
/* -------------------------------------------------------------------------- */

const KNOWN_LOGOS: Record<string, string> = {
	ETH: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
	WETH: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png',
	USDC: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
	USDT: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png',
	DAI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png',
	WBTC: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png',
	LINK: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x514910771AF9Ca656af840dff83E8264EcF986CA/logo.png',
	UNI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984/logo.png',
};

const FALLBACK_COLORS: Record<string, { bg: string; text: string }> = {
	ETH: { bg: 'bg-[#627EEA]/12', text: 'text-[#627EEA]' },
	WETH: { bg: 'bg-[#627EEA]/12', text: 'text-[#627EEA]' },
	USDC: { bg: 'bg-[#2775CA]/12', text: 'text-[#2775CA]' },
	USDT: { bg: 'bg-[#26A17B]/12', text: 'text-[#26A17B]' },
	DAI: { bg: 'bg-[#F5AC37]/12', text: 'text-[#F5AC37]' },
	WBTC: { bg: 'bg-[#F09242]/12', text: 'text-[#F09242]' },
	LINK: { bg: 'bg-[#2A5ADA]/12', text: 'text-[#2A5ADA]' },
	UNI: { bg: 'bg-[#FF007A]/12', text: 'text-[#FF007A]' },
};

const DEFAULT_COLOR = { bg: 'bg-stone-500/10', text: 'text-stone-500' };

function TokenLogo({ symbol, logoUrl }: { symbol: string; logoUrl: string | null }) {
	const [imgFailed, setImgFailed] = useState(false);
	const src = logoUrl ?? KNOWN_LOGOS[symbol.toUpperCase()];
	const colors = FALLBACK_COLORS[symbol.toUpperCase()] ?? DEFAULT_COLOR;

	if (src && !imgFailed) {
		return (
			<div className="relative h-9 w-9 shrink-0">
				<img
					src={src}
					alt={symbol}
					className="h-9 w-9 rounded-full object-cover"
					onError={() => setImgFailed(true)}
				/>
			</div>
		);
	}

	return (
		<div
			className={cn(
				'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold',
				colors.bg,
				colors.text,
			)}
		>
			{symbol.length <= 4 ? symbol : symbol.slice(0, 3)}
		</div>
	);
}

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
				<TokenLogo symbol={token.symbol} logoUrl={token.logoUrl} />
				<div className="min-w-0">
					<div className="text-sm font-semibold text-text">{token.symbol}</div>
					<div className="text-[12px] text-text-dim truncate">{token.name}</div>
				</div>
			</div>
			<div className="flex items-center gap-2 shrink-0 pl-3">
				<div className="text-right">
					<span className={cn(
						'text-sm font-semibold tabular-nums font-mono',
						isZero ? 'text-text-dim' : 'text-text',
					)}>
						{formatted}
					</span>
					<span className={cn(
						'ml-1 text-xs',
						isZero ? 'text-text-dim/60' : 'text-text-muted',
					)}>
						{token.symbol}
					</span>
				</div>
				{signerId && (
					<Link
						to={`/signers/${signerId}/sign?token=${token.symbol}`}
						className="flex h-7 w-7 items-center justify-center rounded-full opacity-0 group-hover:opacity-100 bg-accent text-accent-foreground transition-all duration-150 hover:scale-110"
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
						className="flex h-7 w-7 items-center justify-center rounded-full opacity-0 group-hover:opacity-100 text-text-dim hover:text-danger hover:bg-danger-muted transition-all duration-150"
						aria-label={`Remove ${token.symbol}`}
					>
						<Trash2 className="h-3.5 w-3.5" />
					</button>
				)}
			</div>
		</div>
	);
}
