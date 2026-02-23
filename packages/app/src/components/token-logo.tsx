import { cn } from '@/lib/utils';
import { useState } from 'react';

/* -------------------------------------------------------------------------- */
/*  Shared token logo data — single source of truth                           */
/* -------------------------------------------------------------------------- */

export const KNOWN_LOGOS: Record<string, string> = {
	ETH: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
	WETH: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png',
	USDC: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
	USDT: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png',
	DAI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png',
	WBTC: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png',
	LINK: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x514910771AF9Ca656af840dff83E8264EcF986CA/logo.png',
	UNI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984/logo.png',
};

export const TOKEN_COLORS: Record<string, { bg: string; text: string }> = {
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

/** Combined class string for simple consumers (e.g. sign.tsx). */
export function getTokenColorClass(symbol: string): string {
	const c = TOKEN_COLORS[symbol.toUpperCase()];
	if (c) return `${c.bg} ${c.text}`;
	return `${DEFAULT_COLOR.bg} ${DEFAULT_COLOR.text}`;
}

/* -------------------------------------------------------------------------- */
/*  Shared TokenLogo component                                                */
/* -------------------------------------------------------------------------- */

interface TokenLogoProps {
	symbol: string;
	logoUrl?: string | null;
	/** Tailwind size class — h-N w-N. Defaults to h-9 w-9. */
	size?: 'sm' | 'md';
}

const SIZE_CLASSES = {
	sm: { img: 'h-7 w-7', text: 'text-[10px]' },
	md: { img: 'h-9 w-9', text: 'text-xs' },
};

export function TokenLogo({ symbol, logoUrl, size = 'md' }: TokenLogoProps) {
	const [imgFailed, setImgFailed] = useState(false);
	const src = logoUrl ?? KNOWN_LOGOS[symbol.toUpperCase()];
	const colors = TOKEN_COLORS[symbol.toUpperCase()] ?? DEFAULT_COLOR;
	const s = SIZE_CLASSES[size];

	if (src && !imgFailed) {
		return (
			<div className={cn('relative shrink-0', s.img)}>
				<img
					src={src}
					alt={symbol}
					className={cn(s.img, 'rounded-full object-cover')}
					onError={() => setImgFailed(true)}
				/>
			</div>
		);
	}

	return (
		<div
			className={cn(
				'flex shrink-0 items-center justify-center rounded-full font-bold',
				s.img,
				s.text,
				colors.bg,
				colors.text,
			)}
		>
			{symbol.length <= 4 ? symbol : symbol.slice(0, 3)}
		</div>
	);
}
