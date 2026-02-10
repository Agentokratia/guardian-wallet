import { Addr } from '@/components/ui/addr';
import { Card, CardContent } from '@/components/ui/card';
import { Dot } from '@/components/ui/dot';
import { Mono } from '@/components/ui/mono';
import { getTypeIcon, statusConfig } from '@/lib/signer-constants';
import type { Signer } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ArrowUpRight, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';

interface SignerCardProps {
	signer: Signer;
	policyCount?: number;
	balance?: string;
	tokenSummary?: string;
	lastAction?: string;
}

export function SignerCard({ signer, policyCount = 0, balance, tokenSummary, lastAction }: SignerCardProps) {
	const icon = getTypeIcon(signer.type, 'h-4 w-4');
	const status = statusConfig[signer.status];

	const balanceDisplay = tokenSummary || balance || '---';

	return (
		<Link to={`/signers/${signer.id}`}>
			<Card
				className={cn(
					'group cursor-pointer border-border bg-surface transition-all hover:border-border-light hover:shadow-sm',
					signer.status === 'revoked' && 'opacity-50',
				)}
			>
				<CardContent className="p-5">
					{/* Header: icon + name + status */}
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/[0.06] text-text-muted">
								{icon}
							</div>
							<div>
								<div className="text-sm font-semibold text-text">{signer.name}</div>
								<Addr address={signer.ethAddress} />
							</div>
						</div>
						<div className="flex items-center gap-1.5">
							<Dot color={status.dot} className="h-1.5 w-1.5" />
							<Mono size="xs" className="text-text-dim">{status.label}</Mono>
						</div>
					</div>

					{/* Balance — prominent */}
					<div className="mt-4">
						<div className="text-2xl font-bold tabular-nums tracking-tight text-text">
							{balanceDisplay}
						</div>
					</div>

					{/* Footer: policies + security + last action + arrow */}
					<div className="mt-3 flex items-center justify-between border-t border-border pt-3">
						<div className="flex items-center gap-3 text-[12px] text-text-dim">
							{policyCount > 0 && (
								<span className="flex items-center gap-1">
									<Shield className="h-3 w-3" />
									{policyCount} polic{policyCount === 1 ? 'y' : 'ies'}
								</span>
							)}
							{lastAction && (
								<>
									{policyCount > 0 && <span className="text-border-light">|</span>}
									<span className="truncate max-w-[160px]">{lastAction}</span>
								</>
							)}
						</div>
						<div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/[0.04] text-text-dim opacity-0 group-hover:opacity-100 transition-opacity">
							<ArrowUpRight className="h-3.5 w-3.5" />
						</div>
					</div>
				</CardContent>
			</Card>
		</Link>
	);
}
