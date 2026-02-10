import { formatUnits } from 'viem';

export function formatWei(wei: string | bigint): string {
	const value = typeof wei === 'string' ? BigInt(wei) : wei;
	if (value === 0n) return '0 ETH';
	const formatted = formatUnits(value, 18);
	const [whole, frac] = formatted.split('.');
	if (!frac) return `${whole} ETH`;
	const trimmed = frac.slice(0, 6).replace(/0+$/, '');
	if (trimmed === '') return `${whole} ETH`;
	return `${whole}.${trimmed} ETH`;
}

export function formatTimestamp(date: string | Date): string {
	const d = typeof date === 'string' ? new Date(date) : date;
	const now = Date.now();
	const diff = now - d.getTime();
	const seconds = Math.floor(diff / 1000);

	if (seconds < 60) return 'just now';
	if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
	if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

	return d.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
	});
}

export function formatTxHash(hash: string): string {
	if (hash.length < 14) return hash;
	return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

export function formatTokenBalance(rawBalance: string, decimals: number): string {
	const formatted = formatUnits(BigInt(rawBalance), decimals);
	const [whole, frac] = formatted.split('.');
	if (!frac) return whole ?? '0';
	const trimmed = frac.slice(0, 6).replace(/0+$/, '');
	if (trimmed === '') return whole ?? '0';
	return `${whole}.${trimmed}`;
}
