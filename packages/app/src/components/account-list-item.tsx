import { Dot } from '@/components/ui/dot';
import { Mono } from '@/components/ui/mono';
import { getTypeIcon, statusConfig } from '@/lib/signer-constants';
import type { Signer } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';

interface AccountListItemProps {
	signer: Signer;
	balance?: string;
	isActive: boolean;
}

export function AccountListItem({ signer, balance, isActive }: AccountListItemProps) {
	const status = statusConfig[signer.status];
	const icon = getTypeIcon(signer.type, 'h-4 w-4');

	return (
		<Link
			to={`/signers/${signer.id}`}
			className={cn(
				'flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors',
				isActive
					? 'bg-accent-muted text-accent'
					: 'text-text-muted hover:bg-surface-hover hover:text-text',
			)}
		>
			<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent">
				{icon}
			</div>
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-1.5">
					<span className="text-[13px] font-medium truncate">{signer.name}</span>
					<Dot color={status.dot} className="h-1.5 w-1.5" />
				</div>
				{balance && (
					<Mono size="xs" className="text-text-dim truncate">
						{balance}
					</Mono>
				)}
			</div>
		</Link>
	);
}
