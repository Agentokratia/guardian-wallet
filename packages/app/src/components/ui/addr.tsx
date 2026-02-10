import { cn } from '@/lib/utils';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

interface AddrProps {
	address: string;
	className?: string;
	full?: boolean;
}

export function Addr({ address, className, full = false }: AddrProps) {
	const [copied, setCopied] = useState(false);
	const display = full ? address : `${address.slice(0, 6)}...${address.slice(-4)}`;

	const handleCopy = async () => {
		await navigator.clipboard.writeText(address);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<button
			type="button"
			onClick={handleCopy}
			className={cn(
				'inline-flex items-center gap-1.5 font-mono text-xs text-text-muted bg-surface px-1.5 py-0.5 rounded cursor-pointer hover:bg-surface-hover transition-colors',
				className,
			)}
			title={`${address} — click to copy`}
		>
			{display}
			{copied ? (
				<Check className="h-3 w-3 text-success" />
			) : (
				<Copy className="h-3 w-3 opacity-50" />
			)}
		</button>
	);
}
