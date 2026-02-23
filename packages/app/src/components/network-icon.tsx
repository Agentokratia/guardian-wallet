import { cn } from '@/lib/utils';
import { useState } from 'react';

interface NetworkIconProps {
	network: string;
	size?: 'sm' | 'md' | 'lg';
	className?: string;
}

/* -------------------------------------------------------------------------- */
/*  Chain logo URLs — official logos from trusted CDNs                          */
/* -------------------------------------------------------------------------- */

const TW = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains';

const CHAIN_LOGOS: Record<string, string> = {
	mainnet: `${TW}/ethereum/info/logo.png`,
	sepolia: `${TW}/ethereum/info/logo.png`,
	base: `${TW}/base/info/logo.png`,
	'base-sepolia': `${TW}/base/info/logo.png`,
	arbitrum: `${TW}/arbitrum/info/logo.png`,
	'arbitrum-sepolia': `${TW}/arbitrum/info/logo.png`,
	optimism: `${TW}/optimism/info/logo.png`,
	'optimism-sepolia': `${TW}/optimism/info/logo.png`,
	polygon: `${TW}/polygon/info/logo.png`,
	'polygon-amoy': `${TW}/polygon/info/logo.png`,
};

const FALLBACK_COLORS: Record<string, { bg: string; text: string; letter: string }> = {
	mainnet: { bg: 'bg-[#627EEA]/12', text: 'text-[#627EEA]', letter: 'E' },
	sepolia: { bg: 'bg-[#627EEA]/12', text: 'text-[#627EEA]', letter: 'S' },
	base: { bg: 'bg-[#0052FF]/12', text: 'text-[#0052FF]', letter: 'B' },
	'base-sepolia': { bg: 'bg-[#0052FF]/12', text: 'text-[#0052FF]', letter: 'B' },
	arbitrum: { bg: 'bg-[#28A0F0]/12', text: 'text-[#28A0F0]', letter: 'A' },
	'arbitrum-sepolia': { bg: 'bg-[#28A0F0]/12', text: 'text-[#28A0F0]', letter: 'A' },
	optimism: { bg: 'bg-[#FF0420]/12', text: 'text-[#FF0420]', letter: 'O' },
	'optimism-sepolia': { bg: 'bg-[#FF0420]/12', text: 'text-[#FF0420]', letter: 'O' },
	polygon: { bg: 'bg-[#8247E5]/12', text: 'text-[#8247E5]', letter: 'P' },
	'polygon-amoy': { bg: 'bg-[#8247E5]/12', text: 'text-[#8247E5]', letter: 'P' },
};

const DEFAULT_FALLBACK = { bg: 'bg-stone-500/10', text: 'text-stone-500', letter: '?' };

const SIZE_MAP = {
	sm: 'h-5 w-5',
	md: 'h-6 w-6',
	lg: 'h-8 w-8',
} as const;

const FONT_SIZE_MAP = {
	sm: 'text-[10px]',
	md: 'text-xs',
	lg: 'text-sm',
} as const;

export function NetworkIcon({ network, size = 'md', className }: NetworkIconProps) {
	const [imgFailed, setImgFailed] = useState(false);
	const src = CHAIN_LOGOS[network];
	const fallback = FALLBACK_COLORS[network] ?? DEFAULT_FALLBACK;

	if (src && !imgFailed) {
		return (
			<img
				src={src}
				alt={network}
				className={cn('shrink-0 rounded-full object-cover', SIZE_MAP[size], className)}
				onError={() => setImgFailed(true)}
			/>
		);
	}

	return (
		<div
			className={cn(
				'flex shrink-0 items-center justify-center rounded-full font-bold',
				fallback.bg,
				fallback.text,
				SIZE_MAP[size],
				FONT_SIZE_MAP[size],
				className,
			)}
		>
			{fallback.letter}
		</div>
	);
}
