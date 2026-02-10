import { Addr } from '@/components/ui/addr';
import { Mono } from '@/components/ui/mono';
import { Pill } from '@/components/ui/pill';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { getExplorerTxUrlByChainId } from '@/lib/chains';
import { formatTimestamp, formatWei } from '@/lib/formatters';
import { statusColor } from '@/lib/status-colors';
import type { SigningRequest } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ExternalLink } from 'lucide-react';

/** Human-readable action label from requestType + decodedAction. */
function actionLabel(row: SigningRequest): string {
	if (row.decodedAction) return row.decodedAction;
	switch (row.requestType) {
		case 'sign-tx':
			return row.valueWei && row.valueWei !== '0' ? 'ETH Transfer' : 'Contract Call';
		case 'sign-message':
			return 'Sign Message';
		default:
			return row.requestType;
	}
}

interface ActivityTableProps {
	rows: SigningRequest[];
	showSigner?: boolean;
	signerNames?: Record<string, string>;
	className?: string;
}

export function ActivityTable({
	rows,
	showSigner = true,
	signerNames,
	className,
}: ActivityTableProps) {
	if (rows.length === 0) {
		return (
			<div className={cn('rounded-lg border border-border bg-surface p-8 text-center', className)}>
				<Mono size="sm" className="text-text-dim">
					No activity yet
				</Mono>
			</div>
		);
	}

	return (
		<div className={cn('rounded-lg border border-border bg-surface overflow-hidden', className)}>
			<Table>
				<TableHeader>
					<TableRow className="border-border hover:bg-transparent">
						<TableHead className="text-text-dim text-xs font-semibold uppercase tracking-wider">
							Time
						</TableHead>
						{showSigner && (
							<TableHead className="text-text-dim text-xs font-semibold uppercase tracking-wider">
								Account
							</TableHead>
						)}
						<TableHead className="text-text-dim text-xs font-semibold uppercase tracking-wider">
							Action
						</TableHead>
						<TableHead className="text-text-dim text-xs font-semibold uppercase tracking-wider">
							To
						</TableHead>
						<TableHead className="text-text-dim text-xs font-semibold uppercase tracking-wider">
							Value
						</TableHead>
						<TableHead className="text-text-dim text-xs font-semibold uppercase tracking-wider text-right">
							Status
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row) => {
						const isBlocked = row.status === 'blocked' || row.status === 'failed';
						const color =
							statusColor[row.status as keyof typeof statusColor] ?? ('default' as const);
						const explorerUrl =
							row.txHash && row.chainId
								? getExplorerTxUrlByChainId(row.chainId, row.txHash)
								: null;

						return (
							<TableRow
								key={row.id}
								className={cn('border-border', isBlocked && 'bg-danger-muted')}
							>
								<TableCell>
									<Mono size="xs">{formatTimestamp(row.createdAt)}</Mono>
								</TableCell>
								{showSigner && (
									<TableCell>
										<span className="text-sm text-text">
											{signerNames?.[row.signerId] ?? row.signerId.slice(0, 8)}
										</span>
									</TableCell>
								)}
								<TableCell>
									<span className="text-sm text-text">{actionLabel(row)}</span>
								</TableCell>
								<TableCell>
									{row.toAddress ? (
										<Addr address={row.toAddress} />
									) : (
										<Mono size="xs" className="text-text-dim">
											--
										</Mono>
									)}
								</TableCell>
								<TableCell>
									{row.valueWei ? (
										<span className="text-sm text-text">{formatWei(row.valueWei)}</span>
									) : (
										<Mono size="xs" className="text-text-dim">
											--
										</Mono>
									)}
								</TableCell>
								<TableCell className="text-right">
									<div className="inline-flex items-center gap-1.5">
										<Pill color={color}>{row.status}</Pill>
										{explorerUrl && (
											<a
												href={explorerUrl}
												target="_blank"
												rel="noopener noreferrer"
												className="text-text-dim hover:text-accent transition-colors"
												title="View on explorer"
											>
												<ExternalLink className="h-3.5 w-3.5" />
											</a>
										)}
									</div>
								{isBlocked && row.policyViolations && row.policyViolations.length > 0 && (
									<div className="mt-0.5 space-y-0.5">
										{row.policyViolations.map((v, i) => (
											<div key={i} className="text-[10px] text-danger truncate max-w-[200px]" title={v.reason}>
												{v.reason}
											</div>
										))}
									</div>
								)}
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</div>
	);
}
