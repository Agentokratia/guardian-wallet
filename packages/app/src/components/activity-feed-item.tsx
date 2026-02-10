import { Addr } from '@/components/ui/addr';
import { Mono } from '@/components/ui/mono';
import { Pill } from '@/components/ui/pill';
import { getExplorerTxUrlByChainId } from '@/lib/chains';
import { formatTimestamp, formatWei } from '@/lib/formatters';
import { statusColor } from '@/lib/status-colors';
import type { SigningRequest } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ArrowUpRight, ExternalLink, FileText, ShieldAlert, ShieldOff } from 'lucide-react';

function actionLabel(entry: SigningRequest): string {
	if (entry.decodedAction) return entry.decodedAction;
	switch (entry.requestType) {
		case 'sign-tx':
			return entry.valueWei && entry.valueWei !== '0' ? 'ETH Transfer' : 'Contract Call';
		case 'sign-message':
			return 'Sign Message';
		default:
			return entry.requestType;
	}
}

function ActionIcon({ entry }: { entry: SigningRequest }) {
	const isBlocked = entry.status === 'blocked' || entry.status === 'failed';
	if (isBlocked) {
		return (
			<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
				<ShieldOff className="h-4 w-4" />
			</div>
		);
	}
	if (entry.requestType === 'sign-message') {
		return (
			<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/[0.06] text-text-muted">
				<FileText className="h-4 w-4" />
			</div>
		);
	}
	return (
		<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/[0.06] text-text-muted">
			<ArrowUpRight className="h-4 w-4" />
		</div>
	);
}

interface ActivityFeedItemProps {
	entry: SigningRequest;
	signerName?: string;
	showSigner?: boolean;
}

export function ActivityFeedItem({ entry, signerName, showSigner = false }: ActivityFeedItemProps) {
	const color = statusColor[entry.status as keyof typeof statusColor] ?? ('default' as const);
	const isBlocked = entry.status === 'blocked' || entry.status === 'failed';
	const explorerUrl =
		entry.txHash && entry.chainId
			? getExplorerTxUrlByChainId(entry.chainId, entry.txHash)
			: null;

	return (
		<div
			className={cn(
				'flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-surface-hover',
				isBlocked && 'bg-danger/[0.02]',
			)}
		>
			<ActionIcon entry={entry} />
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium text-text truncate">
						{actionLabel(entry)}
					</span>
					{showSigner && signerName && (
						<span className="text-[11px] text-text-dim truncate rounded-full bg-surface-hover px-2 py-0.5">
							{signerName}
						</span>
					)}
				</div>
				<div className="flex items-center gap-2 mt-0.5">
					{entry.toAddress ? (
						<Addr address={entry.toAddress} />
					) : (
						<Mono size="xs" className="text-text-dim">
							--
						</Mono>
					)}
					<Mono size="xs" className="text-text-dim">
						{formatTimestamp(entry.createdAt)}
					</Mono>
				</div>
				{isBlocked && entry.policyViolations && entry.policyViolations.length > 0 && (
					<div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-danger/80">
						<ShieldAlert className="h-3 w-3 mt-0.5 shrink-0" />
						<span className="leading-tight">
							{entry.policyViolations.map((v) => v.reason).join('; ')}
						</span>
					</div>
				)}
			</div>
			<div className="flex flex-col items-end gap-1.5 shrink-0">
				<div className="flex items-center gap-1.5">
					{entry.valueWei && entry.valueWei !== '0' ? (
						<span
							className={cn(
								'text-sm font-semibold tabular-nums',
								isBlocked ? 'text-text-dim line-through' : 'text-text',
							)}
						>
							{formatWei(entry.valueWei)}
						</span>
					) : null}
					{explorerUrl && (
						<a
							href={explorerUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="text-text-dim hover:text-accent transition-colors"
							title="View on explorer"
						>
							<ExternalLink className="h-3 w-3" />
						</a>
					)}
				</div>
				<Pill color={color}>{entry.status}</Pill>
			</div>
		</div>
	);
}
