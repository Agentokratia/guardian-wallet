import { ActivityFeed } from '@/components/activity-feed';
import { AddTokenDialog } from '@/components/add-token-dialog';
import { BadgeDialog } from '@/components/certification/badge-dialog';
import { NetworkIcon } from '@/components/network-icon';
import { ReceiveDialog } from '@/components/receive-dialog';
import { SignerSubnav } from '@/components/signer-subnav';
import { TokenLogo } from '@/components/token-logo';
import { Button } from '@/components/ui/button';
import { useAllTokenBalances } from '@/hooks/use-all-token-balances';
import { useAuditLog } from '@/hooks/use-audit-log';
import { useBalance } from '@/hooks/use-balance';
import { useCertification } from '@/hooks/use-certification';
import { type Network, useNetworks } from '@/hooks/use-networks';
import { usePolicy } from '@/hooks/use-policies';
import { useSigner } from '@/hooks/use-signer';
import type { TokenBalance } from '@/hooks/use-token-balances';
import { TIER_COLORS } from '@/lib/certification-score';
import { formatTokenBalance, formatWei } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { CRITERION_CATALOG } from '@agentokratia/guardian-core';
import {
	ArrowDownLeft,
	ArrowRight,
	ArrowUpRight,
	Check,
	CheckCircle2,
	ChevronDown,
	Copy,
	Loader2,
	Plus,
	Shield,
	ShieldCheck,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Types                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface AggregatedToken {
	symbol: string;
	name: string;
	decimals: number;
	logoUrl: string | null;
	totalBalance: bigint;
	networks: {
		network: string;
		displayName: string;
		balance: bigint;
		token: TokenBalance;
	}[];
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Helpers                                                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

function CopyButton({ text, className }: { text: string; className?: string }) {
	const [copied, setCopied] = useState(false);
	const handleCopy = async () => {
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};
	return (
		<button
			type="button"
			onClick={handleCopy}
			className={`shrink-0 transition-colors ${className ?? 'text-text-dim hover:text-text'}`}
			aria-label="Copy"
		>
			{copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
		</button>
	);
}

/* ─── Token row ───────────────────────────────────────────────────────────── */

function TokenRow({
	token,
	signerId,
	multiNetwork,
}: {
	token: AggregatedToken;
	signerId: string;
	multiNetwork: boolean;
}) {
	const [expanded, setExpanded] = useState(false);
	const formatted = formatTokenBalance(token.totalBalance.toString(), token.decimals);
	const isZero = token.totalBalance === 0n;
	const canExpand = multiNetwork && token.networks.length > 1;

	return (
		<div>
			<div
				className={cn(
					'group flex items-center gap-2.5 px-3 py-2 transition-colors',
					canExpand ? 'cursor-pointer hover:bg-surface-hover' : '',
				)}
				onClick={canExpand ? () => setExpanded(!expanded) : undefined}
				onKeyDown={
					canExpand
						? (e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									setExpanded(!expanded);
								}
							}
						: undefined
				}
				role={canExpand ? 'button' : undefined}
				tabIndex={canExpand ? 0 : undefined}
			>
				<TokenLogo symbol={token.symbol} logoUrl={token.logoUrl} size="sm" />
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-1.5">
						<span className="text-[12px] font-semibold text-text">{token.symbol}</span>
						{canExpand && (
							<span className="text-[9px] text-text-dim">{token.networks.length} nets</span>
						)}
					</div>
					<div className="text-[10px] text-text-dim truncate">{token.name}</div>
				</div>
				<span
					className={cn(
						'text-[12px] font-semibold tabular-nums font-mono',
						isZero ? 'text-text-dim' : 'text-text',
					)}
				>
					{formatted}
				</span>
				{canExpand && (
					<ChevronDown
						className={cn('h-3 w-3 text-text-dim transition-transform', expanded && 'rotate-180')}
					/>
				)}
				{!canExpand && !isZero && (
					<Link
						to={`/signers/${signerId}/sign?token=${token.symbol}`}
						className="flex h-5 w-5 items-center justify-center rounded-full opacity-0 group-hover:opacity-100 focus-visible:opacity-100 bg-accent text-accent-foreground transition-opacity"
						onClick={(e) => e.stopPropagation()}
						aria-label={`Send ${token.symbol}`}
					>
						<ArrowUpRight className="h-2.5 w-2.5" aria-hidden="true" />
					</Link>
				)}
			</div>
			{expanded && (
				<div className="border-t border-border/50 bg-surface-hover/30">
					{token.networks.map((entry) => {
						const netBal = formatTokenBalance(entry.balance.toString(), token.decimals);
						return (
							<div key={entry.network} className="flex items-center gap-2 px-3 py-1 pl-12">
								<NetworkIcon network={entry.network} size="sm" />
								<span className="text-[10px] text-text-muted flex-1 truncate">
									{entry.displayName}
								</span>
								<span className="text-[10px] font-mono tabular-nums text-text-dim">{netBal}</span>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

/* ─── Guardrails summary ──────────────────────────────────────────────────── */

const CRITERION_BY_TYPE = new Map(CRITERION_CATALOG.map((m) => [m.type, m]));

/** Resolve the correct catalog entry — handles evmAddress `in` vs `not_in`. */
function resolveMeta(c: Record<string, unknown>) {
	if (c.type === 'evmAddress' && c.operator === 'not_in') {
		return CRITERION_BY_TYPE.get('evmAddressBlocked');
	}
	return CRITERION_BY_TYPE.get(c.type as string);
}

/** Quick detail extractor — returns a short string for the sidebar card. */
function getCriterionDetail(c: Record<string, unknown>): string | undefined {
	const type = c.type as string;
	if (type === 'evmAddress') {
		const n = (c.addresses as string[])?.length ?? 0;
		if (c.operator === 'not_in') return n > 0 ? `${n} blocked` : undefined;
		return n > 0 ? `${n} addresses` : undefined;
	}
	if (c.maxUsd !== undefined) return `$${c.maxUsd}`;
	if (c.maxPercent !== undefined) return `${c.maxPercent}%`;
	if (c.maxPerHour !== undefined) return `${c.maxPerHour}/hr`;
	if (c.value !== undefined && type === 'ethValue') return `${c.value} ETH`;
	return undefined;
}

interface RuleSummary {
	label: string;
	detail?: string;
}

function summarizePolicy(rules: Record<string, unknown>[]): RuleSummary[] {
	const items: RuleSummary[] = [];
	for (const rule of rules) {
		for (const c of (rule.criteria ?? []) as Record<string, unknown>[]) {
			const meta = resolveMeta(c);
			// Hide empty allowlists — "Approved contracts" with 0 addresses is noise
			if (c.type === 'evmAddress' && c.operator === 'in') {
				const n = (c.addresses as string[])?.length ?? 0;
				if (n === 0) continue;
			}
			items.push({
				label: meta?.label ?? (c.type as string),
				detail: getCriterionDetail(c),
			});
		}
	}
	return items;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Main page — 2-column layout, no tabs                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function SignerDetailPage() {
	const { id } = useParams<{ id: string }>();
	const signerId = id ?? '';

	const { data: signer, isLoading: signerLoading } = useSigner(signerId);
	const { data: balanceData, isLoading: balanceLoading } = useBalance(signerId);
	const { data: networks } = useNetworks();
	const { data: policyDoc } = usePolicy(signerId);
	const certification = useCertification(signerId);

	const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null);
	const [addTokenOpen, setAddTokenOpen] = useState(false);
	const [receiveOpen, setReceiveOpen] = useState(false);
	const [badgeOpen, setBadgeOpen] = useState(false);
	const [showNetworks, setShowNetworks] = useState(false);
	const [showZeroTokens, setShowZeroTokens] = useState(false);

	const selectedChainId = useMemo(() => {
		if (!selectedNetwork || !networks) return undefined;
		return networks.find((n) => n.name === selectedNetwork)?.chainId;
	}, [selectedNetwork, networks]);

	const networkMap = useMemo(() => {
		if (!networks) return new Map<string, Network>();
		return new Map(networks.map((n) => [n.name, n]));
	}, [networks]);

	const totalBalance = useMemo(() => {
		if (!balanceData?.balances) return '0 ETH';
		const total = balanceData.balances.reduce((sum, b) => sum + BigInt(b.balance), 0n);
		return formatWei(total.toString());
	}, [balanceData]);

	const networkChainIds = useMemo(() => {
		if (!networks) return [];
		return networks.filter((n) => n.enabled).map((n) => ({ network: n.name, chainId: n.chainId }));
	}, [networks]);

	const { groups: tokenGroups, isLoading: tokensLoading } = useAllTokenBalances(
		signerId,
		networkChainIds,
	);

	const todayStart = useMemo(() => {
		const d = new Date();
		d.setHours(0, 0, 0, 0);
		return d.toISOString();
	}, []);

	// Use same query shape as useCertification (limit: 500, no date filter)
	// so TanStack Query deduplicates the request instead of double-fetching
	const { data: activity, isLoading: activityLoading } = useAuditLog({
		signerId,
		limit: 500,
	});

	const todayActivity = useMemo(() => {
		const cutoff = new Date(todayStart).getTime();
		return (activity ?? []).filter((a) => new Date(a.createdAt).getTime() >= cutoff);
	}, [activity, todayStart]);

	const todaysSpend = useMemo(() => {
		const spend = todayActivity
			.filter(
				(a) =>
					(a.status === 'approved' || a.status === 'broadcast' || a.status === 'completed') &&
					a.valueWei,
			)
			.reduce((sum, a) => sum + BigInt(a.valueWei ?? '0'), 0n);
		return spend > 0n ? formatWei(spend.toString()) : '0 ETH';
	}, [todayActivity]);

	const requestsToday = todayActivity.length;

	const aggregatedTokens = useMemo(() => {
		const map = new Map<string, AggregatedToken>();
		for (const group of tokenGroups) {
			const displayName = networkMap.get(group.network)?.displayName ?? group.network;
			for (const token of group.tokens) {
				const key = token.symbol.toUpperCase();
				const bal = BigInt(token.balance);
				const existing = map.get(key);
				if (existing) {
					existing.totalBalance += bal;
					existing.networks.push({
						network: group.network,
						displayName,
						balance: bal,
						token,
					});
				} else {
					map.set(key, {
						symbol: token.symbol,
						name: token.name,
						decimals: token.decimals,
						logoUrl: token.logoUrl,
						totalBalance: bal,
						networks: [
							{
								network: group.network,
								displayName,
								balance: bal,
								token,
							},
						],
					});
				}
			}
		}
		return [...map.values()].sort((a, b) => {
			if (a.totalBalance > 0n && b.totalBalance === 0n) return -1;
			if (a.totalBalance === 0n && b.totalBalance > 0n) return 1;
			return a.symbol.localeCompare(b.symbol);
		});
	}, [tokenGroups, networkMap]);

	const fundedTokens = useMemo(
		() => aggregatedTokens.filter((t) => t.totalBalance > 0n),
		[aggregatedTokens],
	);
	const zeroTokens = useMemo(
		() => aggregatedTokens.filter((t) => t.totalBalance === 0n),
		[aggregatedTokens],
	);
	const hasMultipleNetworks = useMemo(
		() => tokenGroups.filter((g) => g.tokens.length > 0).length > 1,
		[tokenGroups],
	);

	// Policy summary — count visible criteria (exclude empty allowlists)
	const policyRules = policyDoc?.rules ?? [];
	const ruleSummaries = useMemo(() => summarizePolicy(policyRules), [policyRules]);
	const ruleCount = ruleSummaries.length;
	const certColors = certification ? TIER_COLORS[certification.tier] : null;

	if (signerLoading) {
		return (
			<SignerSubnav>
				<div className="animate-pulse space-y-4">
					<div className="h-[100px] rounded-xl bg-surface-hover" />
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
						<div className="h-[120px] rounded-xl bg-surface-hover" />
						<div className="h-[120px] rounded-xl bg-surface-hover" />
					</div>
					<div className="h-[160px] rounded-xl bg-surface-hover" />
					<div className="h-[240px] rounded-xl bg-surface-hover" />
				</div>
			</SignerSubnav>
		);
	}

	if (!signer) {
		return (
			<SignerSubnav>
				<div className="rounded-xl border border-border bg-surface px-6 py-10 text-center">
					<p className="text-sm font-medium text-text-muted">Account not found</p>
					<p className="mt-1 text-[11px] text-text-dim">
						This signer may have been removed or the ID is invalid.
					</p>
					<Link
						to="/signers"
						className="mt-3 inline-flex text-[12px] font-medium text-accent hover:underline"
					>
						Back to accounts
					</Link>
				</div>
			</SignerSubnav>
		);
	}

	const networkCount = balanceData?.balances?.length ?? 0;
	const fundedNetworkCount =
		balanceData?.balances?.filter((b) => BigInt(b.balance) > 0n).length ?? 0;
	const sendPath = selectedNetwork
		? `/signers/${signerId}/sign?network=${selectedNetwork}`
		: `/signers/${signerId}/sign`;

	return (
		<SignerSubnav>
			{/* ══════════════════════════════════════════════════════════ */}
			{/*  BALANCE HERO — compact, with inline stats               */}
			{/* ══════════════════════════════════════════════════════════ */}
			<div className="rounded-xl border border-border bg-surface">
				<div className="px-5 py-4">
					<div className="flex items-start justify-between gap-4">
						<div>
							<p className="text-[10px] font-medium uppercase tracking-wider text-text-dim">
								Total Balance
							</p>
							<div className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight text-text">
								{balanceLoading ? (
									<Loader2 className="h-5 w-5 animate-spin text-text-dim" />
								) : (
									totalBalance
								)}
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Link
								to={sendPath}
								className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-[11px] font-semibold text-accent-foreground shadow-sm transition-[background-color,transform] hover:bg-accent-hover active:scale-[0.97]"
							>
								<ArrowUpRight className="h-3 w-3" />
								Send
							</Link>
							<button
								type="button"
								onClick={() => setReceiveOpen(true)}
								className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3.5 py-1.5 text-[11px] font-semibold text-text-muted transition-[background-color,transform] hover:bg-surface-hover active:scale-[0.97]"
							>
								<ArrowDownLeft className="h-3 w-3" />
								Receive
							</button>
						</div>
					</div>
				</div>

				{/* Inline stats bar */}
				<div className="flex items-center gap-4 border-t border-border px-5 py-2 text-[11px] text-text-dim">
					<span>
						<strong className="text-text-muted">{todaysSpend}</strong> spent today
					</span>
					<span className="text-border">|</span>
					<span>{requestsToday} requests</span>
					{networkCount > 0 && (
						<>
							<span className="text-border">|</span>
							<button
								type="button"
								onClick={() => setShowNetworks(!showNetworks)}
								className="flex items-center gap-1 hover:text-text-muted transition-colors"
							>
								{fundedNetworkCount > 0 ? `${fundedNetworkCount}/${networkCount}` : networkCount}{' '}
								networks
								<ChevronDown
									className={cn('h-3 w-3 transition-transform', showNetworks && 'rotate-180')}
								/>
							</button>
						</>
					)}
				</div>

				{/* Network breakdown */}
				{showNetworks && balanceData?.balances && balanceData.balances.length > 0 && (
					<div className="border-t border-border px-5 py-2">
						<div className="grid grid-cols-2 gap-1">
							{balanceData.balances.map((nb) => {
								const isZero = BigInt(nb.balance) === 0n;
								const isActive = nb.network === selectedNetwork;
								return (
									<button
										type="button"
										key={nb.network}
										onClick={() =>
											setSelectedNetwork(nb.network === selectedNetwork ? null : nb.network)
										}
										className={cn(
											'flex items-center justify-between rounded-md px-2 py-1 text-[11px] transition-colors',
											isActive ? 'bg-accent-muted' : 'hover:bg-surface-hover',
											isZero && !isActive && 'opacity-35',
										)}
									>
										<div className="flex items-center gap-1.5">
											<NetworkIcon network={nb.network} size="sm" />
											<span
												className={cn('font-medium', isActive ? 'text-text' : 'text-text-muted')}
											>
												{networkMap.get(nb.network)?.displayName ?? nb.network}
											</span>
										</div>
										<span
											className={cn(
												'font-mono text-[10px] tabular-nums',
												isActive ? 'text-text' : 'text-text-dim',
											)}
										>
											{formatWei(nb.balance)}
										</span>
									</button>
								);
							})}
						</div>
					</div>
				)}
			</div>

			{/* ══════════════════════════════════════════════════════════ */}
			{/*  PROTECTION BAND — guardrails + cert side by side        */}
			{/* ══════════════════════════════════════════════════════════ */}
			<div
				className={cn(
					'grid grid-cols-1 gap-4',
					certification && certColors ? 'lg:grid-cols-2' : '',
				)}
			>
				{/* Guardrails summary */}
				<div className="rounded-xl border border-border bg-surface">
					<div className="flex items-center justify-between px-4 py-3 border-b border-border">
						<div className="flex items-center gap-2">
							<Shield className="h-3.5 w-3.5 text-text-muted" />
							<span className="text-[13px] font-semibold text-text">Guardrails</span>
						</div>
						<Link
							to={`/signers/${signerId}/guardrails`}
							className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
						>
							{ruleCount > 0 ? 'Edit' : 'Set up'}
							<ArrowRight className="h-3 w-3" />
						</Link>
					</div>

					{ruleCount > 0 ? (
						<div className="px-4 py-3 space-y-2">
							<div className="flex items-center gap-2">
								<span className="h-1.5 w-1.5 rounded-full bg-success" />
								<span className="text-[11px] font-medium text-success">Active</span>
								<span className="text-[10px] text-text-dim">
									{ruleCount} guardrail
									{ruleCount !== 1 ? 's' : ''}
								</span>
							</div>
							<div className="space-y-1.5">
								{ruleSummaries.map((s, i) => (
									<div key={`${s.label}-${i}`} className="flex items-center gap-2">
										<CheckCircle2 className="h-3 w-3 text-success shrink-0" />
										<span className="text-[11px] text-text-muted">{s.label}</span>
										{s.detail && (
											<span className="text-[10px] font-mono text-text-dim">{s.detail}</span>
										)}
									</div>
								))}
							</div>
						</div>
					) : (
						<div className="px-4 py-5 text-center">
							<p className="text-[11px] text-text-dim">No guardrails configured.</p>
							<p className="mt-1 text-[10px] text-text-dim/70">
								Set spending limits, whitelist contracts, and block exploits.
							</p>
						</div>
					)}
				</div>

				{/* Certification — compact */}
				{certification && certColors && (
					<div className="rounded-xl border border-border bg-surface">
						<div className="flex items-center justify-between px-4 py-3">
							<div className="flex items-center gap-2.5">
								<div
									className={cn(
										'flex h-7 w-7 items-center justify-center rounded-lg',
										certColors.bg,
									)}
								>
									<ShieldCheck className={cn('h-3.5 w-3.5', certColors.text)} />
								</div>
								<div>
									<div className="flex items-center gap-1.5">
										<span className={cn('text-[12px] font-bold', certColors.text)}>
											{certification.tierLabel}
										</span>
										<span className="text-[12px] font-bold tabular-nums text-text">
											{certification.score}
											<span className="text-text-dim font-normal">/100</span>
										</span>
									</div>
									<p className="text-[10px] text-text-dim mt-0.5">
										{certification.tierDescription}
									</p>
								</div>
							</div>
							<button
								type="button"
								onClick={() => setBadgeOpen(true)}
								className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[10px] font-medium text-text-muted hover:bg-surface-hover transition-colors"
							>
								Badge
							</button>
						</div>

						{/* Pillar bars — ultra compact */}
						<div className="flex gap-3 border-t border-border px-4 py-2.5">
							{[
								{
									label: 'Policy',
									value: certification.policyPosture.total,
									max: 45,
								},
								{
									label: 'Compliance',
									value: certification.compliance.score,
									max: 35,
								},
								{
									label: 'Maturity',
									value: certification.maturity.total,
									max: 20,
								},
							].map((p) => (
								<div key={p.label} className="flex-1">
									<div className="flex items-center justify-between mb-1">
										<span className="text-[9px] text-text-dim">{p.label}</span>
										<span className="text-[9px] tabular-nums text-text-dim">
											{p.value}/{p.max}
										</span>
									</div>
									<div className="h-1 rounded-full bg-border">
										<div
											className={cn('h-full rounded-full transition-[width]', certColors.dot)}
											style={{
												width: `${Math.min(100, (p.value / p.max) * 100)}%`,
											}}
										/>
									</div>
								</div>
							))}
						</div>
					</div>
				)}
			</div>

			{/* ══════════════════════════════════════════════════════════ */}
			{/*  TOKENS — full width                                     */}
			{/* ══════════════════════════════════════════════════════════ */}
			<div>
				<div className="mb-2 flex items-center justify-between">
					<h2 className="text-[13px] font-semibold text-text">Tokens</h2>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setAddTokenOpen(true)}
						className="h-7 text-[11px]"
					>
						<Plus className="h-3 w-3" />
						Add
					</Button>
				</div>

				{tokensLoading ? (
					<div className="rounded-xl border border-border bg-surface animate-pulse">
						{Array.from({ length: 3 }, (_, i) => (
							<div
								key={`ts-${i}`}
								className="flex items-center gap-2.5 px-3 py-2 border-b border-border last:border-0"
							>
								<div className="h-7 w-7 rounded-full bg-surface-hover" />
								<div className="flex-1 space-y-1">
									<div className="h-3 w-12 rounded animate-shimmer" />
									<div className="h-2.5 w-16 rounded animate-shimmer" />
								</div>
								<div className="h-3 w-14 rounded animate-shimmer" />
							</div>
						))}
					</div>
				) : aggregatedTokens.length > 0 ? (
					<div className="rounded-xl border border-border bg-surface overflow-hidden divide-y divide-border">
						{fundedTokens.map((token) => (
							<TokenRow
								key={token.symbol}
								token={token}
								signerId={signerId}
								multiNetwork={hasMultipleNetworks}
							/>
						))}
						{zeroTokens.length > 0 && (
							<>
								{showZeroTokens &&
									zeroTokens.map((token) => (
										<TokenRow
											key={token.symbol}
											token={token}
											signerId={signerId}
											multiNetwork={hasMultipleNetworks}
										/>
									))}
								<button
									type="button"
									onClick={() => setShowZeroTokens(!showZeroTokens)}
									className="flex w-full items-center justify-center gap-1 py-2 text-[10px] font-medium text-text-dim hover:text-text-muted hover:bg-surface-hover transition-colors"
								>
									<ChevronDown
										className={cn('h-3 w-3 transition-transform', showZeroTokens && 'rotate-180')}
									/>
									{showZeroTokens ? 'Hide zero balances' : `${zeroTokens.length} with zero balance`}
								</button>
							</>
						)}
					</div>
				) : (
					<div className="rounded-xl border border-dashed border-border bg-surface px-5 py-6 text-center">
						<p className="text-[12px] font-medium text-text-muted">No tokens tracked</p>
						<p className="mt-1 text-[10px] text-text-dim">Add ERC-20 tokens to monitor balances.</p>
					</div>
				)}
			</div>

			{/* ══════════════════════════════════════════════════════════ */}
			{/*  ACTIVITY — full width feed                              */}
			{/* ══════════════════════════════════════════════════════════ */}
			<div>
				<h2 className="mb-2 text-[13px] font-semibold text-text">Recent Activity</h2>
				{activityLoading ? (
					<div className="rounded-xl border border-border bg-surface p-4 space-y-2 animate-pulse">
						{Array.from({ length: 3 }, (_, i) => (
							<div key={`a-${i}`} className="h-8 rounded-lg bg-surface-hover" />
						))}
					</div>
				) : (
					<ActivityFeed
						entries={activity ?? []}
						showSigner={false}
						maxItems={8}
						viewAllHref={`/audit?signerId=${signerId}`}
					/>
				)}
			</div>

			{/* ══════════════════════════════════════════════════════════ */}
			{/*  DIALOGS                                                 */}
			{/* ══════════════════════════════════════════════════════════ */}
			<AddTokenDialog
				open={addTokenOpen}
				onOpenChange={setAddTokenOpen}
				signerId={signerId}
				chainId={selectedChainId ?? 1}
			/>
			<ReceiveDialog
				open={receiveOpen}
				onOpenChange={setReceiveOpen}
				address={signer.ethAddress}
				accountName={signer.name}
			/>
			{certification && (
				<BadgeDialog
					open={badgeOpen}
					onOpenChange={setBadgeOpen}
					cert={certification}
					address={signer.ethAddress}
					name={signer.name}
				/>
			)}
		</SignerSubnav>
	);
}
