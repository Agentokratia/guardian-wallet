import { ActivityFeed } from '@/components/activity-feed';
import { FilterBar } from '@/components/filter-bar';
import { Header } from '@/components/layout/header';
import { Addr } from '@/components/ui/addr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mono } from '@/components/ui/mono';
import { Pill } from '@/components/ui/pill';
import { downloadFile } from '@/lib/download';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { useAuditLog } from '@/hooks/use-audit-log';
import { useSigners } from '@/hooks/use-signers';
import { getExplorerTxUrlByChainId } from '@/lib/chains';
import { formatTxHash, formatWei } from '@/lib/formatters';
import { statusColor } from '@/lib/status-colors';
import type { SigningRequest } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Download, ExternalLink, List, Search, TableIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

const PATH_LABELS: Record<string, string> = {
	'agent+server': 'A+S',
	'user+server': 'U+S',
	'agent+user': 'A+U',
};

/** Human-readable action label from requestType + decodedAction. */
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

function formatFullTimestamp(date: string): string {
	const d = new Date(date);
	return d.toLocaleString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	});
}

function exportCsv(data: SigningRequest[]) {
	const headers = [
		'Timestamp',
		'Signer ID',
		'Path',
		'Type',
		'Action',
		'To',
		'Value (wei)',
		'Status',
		'Tx Hash',
		'Policies Evaluated',
		'Evaluation Time (ms)',
	];
	const rows = data.map((r) => [
		r.createdAt,
		r.signerId,
		r.signingPath,
		r.requestType,
		r.decodedAction ?? '',
		r.toAddress ?? '',
		r.valueWei ?? '',
		r.status,
		r.txHash ?? '',
		String(r.policiesEvaluated ?? ''),
		String(r.evaluationTimeMs ?? ''),
	]);
	const csv = [headers, ...rows].map((row) => row.map((c) => `"${c}"`).join(',')).join('\n');
	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
	downloadFile(blob, `audit-log-${new Date().toISOString().slice(0, 10)}.csv`);
}

export function AuditPage() {
	const [signerId, setSignerId] = useState<string>('');
	const [status, setStatus] = useState<string>('');
	const [type, setType] = useState<string>('');
	const [search, setSearch] = useState('');
	const [dateFrom, setDateFrom] = useState('');
	const [dateTo, setDateTo] = useState('');
	const [viewMode, setViewMode] = useState<'feed' | 'table'>('feed');

	const toFilter = (v: string) => (v && v !== '__all__' ? v : undefined);

	const filters = {
		signerId: toFilter(signerId),
		status: toFilter(status),
		requestType: toFilter(type),
		from: dateFrom || undefined,
		to: dateTo || undefined,
		limit: 50,
	};

	const activeFilterCount = [signerId, status, type, dateFrom, dateTo].filter(
		(v) => v && v !== '__all__',
	).length;

	const { data: entries, isLoading } = useAuditLog(filters);
	const { data: signers } = useSigners();

	const signerNameLookup = useMemo(() => {
		const map: Record<string, string> = {};
		for (const s of signers ?? []) {
			map[s.id] = s.name;
		}
		return map;
	}, [signers]);

	const signerNameMap = (id: string) => signerNameLookup[id] ?? id.slice(0, 8);

	const filteredEntries = (entries ?? []).filter((entry) => {
		if (!search) return true;
		const q = search.toLowerCase();
		return (
			entry.toAddress?.toLowerCase().includes(q) ||
			entry.txHash?.toLowerCase().includes(q) ||
			entry.decodedAction?.toLowerCase().includes(q) ||
			signerNameMap(entry.signerId).toLowerCase().includes(q)
		);
	});

	return (
		<>
			<Header
				title="Activity"
				subtitle={<Mono size="sm">All signing requests across all accounts</Mono>}
				actions={
					<div className="flex items-center gap-2">
						{/* View toggle */}
						<div className="flex items-center rounded-lg border border-border bg-surface p-0.5">
							<button
								type="button"
								onClick={() => setViewMode('feed')}
								className={cn(
									'flex items-center justify-center rounded-md px-2 py-1.5 transition-colors',
									viewMode === 'feed'
										? 'bg-accent-muted text-accent'
										: 'text-text-dim hover:text-text',
								)}
								aria-label="Feed view"
							>
								<List className="h-3.5 w-3.5" />
							</button>
							<button
								type="button"
								onClick={() => setViewMode('table')}
								className={cn(
									'flex items-center justify-center rounded-md px-2 py-1.5 transition-colors',
									viewMode === 'table'
										? 'bg-accent-muted text-accent'
										: 'text-text-dim hover:text-text',
								)}
								aria-label="Table view"
							>
								<TableIcon className="h-3.5 w-3.5" />
							</button>
						</div>
						<Button
							variant="outline"
							size="sm"
							onClick={() => entries && exportCsv(entries)}
							disabled={!entries?.length}
						>
							<Download className="h-3.5 w-3.5" />
							Export CSV
						</Button>
					</div>
				}
			/>

			{/* Collapsible filters */}
			<FilterBar activeFilterCount={activeFilterCount}>
				<Select value={signerId} onValueChange={setSignerId}>
					<SelectTrigger className="w-[180px]">
						<SelectValue placeholder="All accounts" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="__all__">All accounts</SelectItem>
						{signers?.map((s) => (
							<SelectItem key={s.id} value={s.id}>
								{s.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Select value={status} onValueChange={setStatus}>
					<SelectTrigger className="w-[150px]">
						<SelectValue placeholder="All statuses" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="__all__">All statuses</SelectItem>
						<SelectItem value="approved">Approved</SelectItem>
						<SelectItem value="blocked">Blocked</SelectItem>
						<SelectItem value="pending">Pending</SelectItem>
						<SelectItem value="failed">Failed</SelectItem>
					</SelectContent>
				</Select>

				<Select value={type} onValueChange={setType}>
					<SelectTrigger className="w-[150px]">
						<SelectValue placeholder="All types" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="__all__">All types</SelectItem>
						<SelectItem value="sign-tx">Transaction</SelectItem>
						<SelectItem value="sign-message">Message</SelectItem>
					</SelectContent>
				</Select>

				<Input
					type="date"
					className="w-[150px] text-xs"
					value={dateFrom}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDateFrom(e.target.value)}
				/>
				<Input
					type="date"
					className="w-[150px] text-xs"
					value={dateTo}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDateTo(e.target.value)}
				/>

				<div className="relative ml-auto">
					<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-dim" />
					<Input
						placeholder="Search address, hash..."
						className="w-[240px] pl-8 font-mono text-xs"
						value={search}
						onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
					/>
				</div>
			</FilterBar>

			{/* Feed view */}
			{viewMode === 'feed' ? (
				isLoading ? (
					<div className="rounded-xl border border-border bg-surface p-8 text-center animate-pulse">
						<div className="h-4 w-32 mx-auto rounded bg-surface-hover" />
					</div>
				) : (
					<>
						<ActivityFeed
							entries={filteredEntries}
							signerNames={signerNameLookup}
							showSigner
						/>
						{filteredEntries.length > 0 && (
							<div className="mt-3 text-[11px] text-text-dim text-right">
								Showing {filteredEntries.length} of {entries?.length ?? 0} entries
							</div>
						)}
					</>
				)
			) : (
				/* Table view */
				<>
					<div className="rounded-lg border border-border bg-surface">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-[170px]">Timestamp</TableHead>
									<TableHead>Account</TableHead>
									<TableHead className="w-[60px]">Path</TableHead>
									<TableHead>Action</TableHead>
									<TableHead>To</TableHead>
									<TableHead className="text-right">Value</TableHead>
									<TableHead className="w-[100px]">Status</TableHead>
									<TableHead>Transaction</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{isLoading ? (
									<TableRow>
										<TableCell colSpan={8} className="text-center py-12 text-text-muted">
											Loading...
										</TableCell>
									</TableRow>
								) : filteredEntries.length === 0 ? (
									<TableRow>
										<TableCell colSpan={8} className="text-center py-12 text-text-muted">
											No signing requests found.
										</TableCell>
									</TableRow>
								) : (
									filteredEntries.map((entry) => {
										const explorerUrl =
											entry.txHash && entry.chainId
												? getExplorerTxUrlByChainId(entry.chainId, entry.txHash)
												: null;

										return (
											<TableRow
												key={entry.id}
												className={
													entry.status === 'blocked'
														? 'bg-danger-muted/30 hover:bg-danger-muted/50'
														: undefined
												}
											>
												<TableCell>
													<Mono size="xs">{formatFullTimestamp(entry.createdAt)}</Mono>
												</TableCell>
												<TableCell>
													<span className="text-sm font-medium text-text">
														{signerNameMap(entry.signerId)}
													</span>
												</TableCell>
												<TableCell>
													<Pill>{PATH_LABELS[entry.signingPath] ?? entry.signingPath}</Pill>
												</TableCell>
												<TableCell>
													<span className="text-sm text-text">{actionLabel(entry)}</span>
												</TableCell>
												<TableCell>
													{entry.toAddress ? (
														<Addr address={entry.toAddress} />
													) : (
														<span className="text-text-dim">--</span>
													)}
												</TableCell>
												<TableCell className="text-right">
													<Mono size="sm">{entry.valueWei ? formatWei(entry.valueWei) : '--'}</Mono>
												</TableCell>
												<TableCell>
													<Pill color={statusColor[entry.status] ?? 'default'}>{entry.status}</Pill>
													{entry.status === 'blocked' && entry.policyViolations && entry.policyViolations.length > 0 && (
														<div className="mt-0.5 space-y-0.5">
															{entry.policyViolations.map((v, i) => (
																<div key={i} className="text-[10px] text-danger truncate max-w-[180px]" title={v.reason}>
																	{v.reason}
																</div>
															))}
														</div>
													)}
												</TableCell>
												<TableCell>
													{entry.txHash ? (
														explorerUrl ? (
															<a
																href={explorerUrl}
																target="_blank"
																rel="noopener noreferrer"
																className="inline-flex items-center gap-1.5 text-accent hover:text-accent/80 transition-colors"
															>
																<Mono size="xs">{formatTxHash(entry.txHash)}</Mono>
																<ExternalLink className="h-3 w-3" />
															</a>
														) : (
															<Mono size="xs">{formatTxHash(entry.txHash)}</Mono>
														)
													) : (
														<span className="text-text-dim">--</span>
													)}
												</TableCell>
											</TableRow>
										);
									})
								)}
							</TableBody>
						</Table>
					</div>

					{filteredEntries.length > 0 && (
						<div className="mt-3 text-[11px] text-text-dim text-right">
							Showing {filteredEntries.length} of {entries?.length ?? 0} entries
						</div>
					)}
				</>
			)}
		</>
	);
}
