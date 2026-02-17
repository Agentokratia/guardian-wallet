import { ActivityFeed } from '@/components/activity-feed';
import { AddTokenDialog } from '@/components/add-token-dialog';
import { NetworkIcon } from '@/components/network-icon';
import { ReceiveDialog } from '@/components/receive-dialog';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { useAllTokenBalances } from '@/hooks/use-all-token-balances';
import { useAuditLog } from '@/hooks/use-audit-log';
import { useBalance } from '@/hooks/use-balance';
import { type Network, useNetworks } from '@/hooks/use-networks';
import { useSigner } from '@/hooks/use-signer';
import { useToast } from '@/hooks/use-toast';
import type { TokenBalance } from '@/hooks/use-token-balances';
import { useRemoveToken } from '@/hooks/use-tokens';
import { formatTokenBalance, formatWei } from '@/lib/formatters';
import { getTypeIcon, statusConfig } from '@/lib/signer-constants';
import { cn } from '@/lib/utils';
import {
	Activity,
	ArrowDownLeft,
	ArrowLeft,
	ArrowUpRight,
	Check,
	ChevronDown,
	Copy,
	Loader2,
	Plus,
	Settings,
	TrendingUp,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

/* ========================================================================== */
/*  Types                                                                      */
/* ========================================================================== */

interface AggregatedToken {
	symbol: string;
	name: string;
	decimals: number;
	logoUrl: string | null;
	totalBalance: bigint;
	/** Per-network breakdown */
	networks: { network: string; displayName: string; balance: bigint; token: TokenBalance }[];
}

/* ========================================================================== */
/*  Sub-components                                                             */
/* ========================================================================== */

function DetailSkeleton() {
	return (
		<div className="animate-pulse space-y-5">
			<div className="h-[160px] rounded-2xl bg-surface-hover" />
			<div className="space-y-3">
				<div className="h-5 w-20 rounded animate-shimmer" />
				<div className="h-[100px] rounded-xl bg-surface-hover" />
			</div>
		</div>
	);
}

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

/* -------------------------------------------------------------------------- */
/*  Token logo                                                                 */
/* -------------------------------------------------------------------------- */

const KNOWN_LOGOS: Record<string, string> = {
	ETH: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
	WETH: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png',
	USDC: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
	USDT: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png',
	DAI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png',
	WBTC: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png',
};

const TOKEN_COLORS: Record<string, { bg: string; text: string }> = {
	ETH: { bg: 'bg-[#627EEA]/12', text: 'text-[#627EEA]' },
	USDC: { bg: 'bg-[#2775CA]/12', text: 'text-[#2775CA]' },
	USDT: { bg: 'bg-[#26A17B]/12', text: 'text-[#26A17B]' },
	DAI: { bg: 'bg-[#F5AC37]/12', text: 'text-[#F5AC37]' },
	WBTC: { bg: 'bg-[#F09242]/12', text: 'text-[#F09242]' },
};

function TokenLogo({ symbol, logoUrl }: { symbol: string; logoUrl: string | null }) {
	const [imgFailed, setImgFailed] = useState(false);
	const src = logoUrl ?? KNOWN_LOGOS[symbol.toUpperCase()];
	const colors = TOKEN_COLORS[symbol.toUpperCase()] ?? {
		bg: 'bg-stone-500/10',
		text: 'text-stone-500',
	};

	if (src && !imgFailed) {
		return (
			<img
				src={src}
				alt={symbol}
				className="h-8 w-8 rounded-full object-cover"
				onError={() => setImgFailed(true)}
			/>
		);
	}

	return (
		<div
			className={cn(
				'flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold',
				colors.bg,
				colors.text,
			)}
		>
			{symbol.length <= 4 ? symbol : symbol.slice(0, 3)}
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/*  Aggregated token row — flat list with expandable per-network breakdown     */
/* -------------------------------------------------------------------------- */

function AggregatedTokenRow({
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
	const networkCount = token.networks.length;
	const canExpand = multiNetwork && networkCount > 1;

	return (
		<div>
			{/* Main row */}
			<div
				className={cn(
					'group flex items-center gap-3 px-4 py-2.5 transition-colors',
					canExpand ? 'cursor-pointer hover:bg-surface-hover' : '',
				)}
				onClick={canExpand ? () => setExpanded(!expanded) : undefined}
				onKeyDown={canExpand ? (e) => e.key === 'Enter' && setExpanded(!expanded) : undefined}
				role={canExpand ? 'button' : undefined}
				tabIndex={canExpand ? 0 : undefined}
			>
				<TokenLogo symbol={token.symbol} logoUrl={token.logoUrl} />

				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-1.5">
						<span className="text-[13px] font-semibold text-text">{token.symbol}</span>
						{canExpand && (
							<span className="text-[10px] text-text-dim">{networkCount} networks</span>
						)}
					</div>
					<div className="text-[11px] text-text-dim truncate">{token.name}</div>
				</div>

				<div className="flex items-center gap-2 shrink-0">
					<span
						className={cn(
							'text-[13px] font-semibold tabular-nums font-mono',
							isZero ? 'text-text-dim' : 'text-text',
						)}
					>
						{formatted}
					</span>
					<span className={cn('text-[11px]', isZero ? 'text-text-dim/50' : 'text-text-muted')}>
						{token.symbol}
					</span>

					{canExpand && (
						<ChevronDown
							className={cn(
								'h-3.5 w-3.5 text-text-dim transition-transform duration-200',
								expanded && 'rotate-180',
							)}
						/>
					)}

					{!canExpand && signerId && (
						<Link
							to={`/signers/${signerId}/sign?token=${token.symbol}`}
							className="flex h-6 w-6 items-center justify-center rounded-full opacity-0 group-hover:opacity-100 bg-accent text-accent-foreground transition-all duration-150 hover:scale-110"
							title={`Send ${token.symbol}`}
							onClick={(e) => e.stopPropagation()}
						>
							<ArrowUpRight className="h-3 w-3" />
						</Link>
					)}
				</div>
			</div>

			{/* Per-network breakdown */}
			{expanded && (
				<div className="border-t border-border bg-surface-hover/40">
					{token.networks.map((entry) => {
						const netBal = formatTokenBalance(entry.balance.toString(), token.decimals);
						const netZero = entry.balance === 0n;
						return (
							<div
								key={entry.network}
								className="group flex items-center gap-2.5 px-4 py-1.5 pl-[60px]"
							>
								<NetworkIcon network={entry.network} size="sm" />
								<span className="text-[11px] text-text-muted flex-1 truncate">
									{entry.displayName}
								</span>
								<span
									className={cn(
										'text-[11px] font-mono tabular-nums',
										netZero ? 'text-text-dim/50' : 'text-text-muted',
									)}
								>
									{netBal} {token.symbol}
								</span>
								{!netZero && signerId && (
									<Link
										to={`/signers/${signerId}/sign?token=${token.symbol}&network=${entry.network}`}
										className="flex h-5 w-5 items-center justify-center rounded-full opacity-0 group-hover:opacity-100 bg-accent text-accent-foreground transition-all duration-150"
										title={`Send from ${entry.displayName}`}
									>
										<ArrowUpRight className="h-2.5 w-2.5" />
									</Link>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

/* ========================================================================== */
/*  Main page                                                                  */
/* ========================================================================== */

export function SignerDetailPage() {
	const { id } = useParams<{ id: string }>();
	const signerId = id ?? '';
	const { toast } = useToast();

	const { data: signer, isLoading: signerLoading } = useSigner(signerId);
	const { data: balanceData, isLoading: balanceLoading } = useBalance(signerId);
	const { data: networks } = useNetworks();

	const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null);

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

	// Derive from networks (available instantly via placeholderData) — no waterfall
	const networkChainIds = useMemo(() => {
		if (!networks) return [];
		return networks
			.filter((n) => n.enabled)
			.map((n) => ({
				network: n.name,
				chainId: n.chainId,
			}));
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

	const { data: activity, isLoading: activityLoading } = useAuditLog({
		signerId,
		from: todayStart,
		limit: 200,
	});

	const [addTokenOpen, setAddTokenOpen] = useState(false);
	const [receiveOpen, setReceiveOpen] = useState(false);
	const [showNetworks, setShowNetworks] = useState(false);
	const [showZeroTokens, setShowZeroTokens] = useState(false);

	const removeToken = useRemoveToken();

	const todaysSpend = useMemo(() => {
		const spend = (activity ?? [])
			.filter(
				(a) =>
					(a.status === 'approved' || a.status === 'broadcast' || a.status === 'completed') &&
					a.valueWei,
			)
			.reduce((sum, a) => sum + BigInt(a.valueWei ?? '0'), 0n);
		return spend > 0n ? formatWei(spend.toString()) : '0 ETH';
	}, [activity]);

	const requestsToday = activity?.length ?? 0;

	/* ---------------------------------------------------------------------- */
	/*  Aggregate tokens by symbol across all networks                         */
	/* ---------------------------------------------------------------------- */
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
					existing.networks.push({ network: group.network, displayName, balance: bal, token });
				} else {
					map.set(key, {
						symbol: token.symbol,
						name: token.name,
						decimals: token.decimals,
						logoUrl: token.logoUrl,
						totalBalance: bal,
						networks: [{ network: group.network, displayName, balance: bal, token }],
					});
				}
			}
		}

		// Sort: funded tokens first, then by symbol
		return [...map.values()].sort((a, b) => {
			if (a.totalBalance > 0n && b.totalBalance === 0n) return -1;
			if (a.totalBalance === 0n && b.totalBalance > 0n) return 1;
			return a.symbol.localeCompare(b.symbol);
		});
	}, [tokenGroups, networkMap]);

	const fundedTokens = aggregatedTokens.filter((t) => t.totalBalance > 0n);
	const zeroTokens = aggregatedTokens.filter((t) => t.totalBalance === 0n);
	const hasMultipleNetworks = tokenGroups.filter((g) => g.tokens.length > 0).length > 1;

	/* Loading */
	if (signerLoading) {
		return (
			<>
				<Link
					to="/signers"
					className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-text-dim hover:text-text-muted transition-colors"
				>
					<ArrowLeft className="h-3.5 w-3.5" />
					Accounts
				</Link>
				<DetailSkeleton />
			</>
		);
	}

	/* Not found */
	if (!signer) {
		return (
			<>
				<Link
					to="/signers"
					className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-text-dim hover:text-text-muted transition-colors"
				>
					<ArrowLeft className="h-3.5 w-3.5" />
					Accounts
				</Link>
				<div className="rounded-xl border border-border bg-surface px-6 py-16 text-center">
					<p className="text-sm text-text-muted">Account not found.</p>
				</div>
			</>
		);
	}

	const status = statusConfig[signer.status];
	const icon = getTypeIcon(signer.type, 'h-4 w-4');

	const networkCount = balanceData?.balances?.length ?? 0;
	const fundedNetworkCount =
		balanceData?.balances?.filter((b) => BigInt(b.balance) > 0n).length ?? 0;

	const sendPath = selectedNetwork
		? `/signers/${signerId}/sign?network=${selectedNetwork}`
		: `/signers/${signerId}/sign`;

	return (
		<div className="space-y-6">
			{/* Breadcrumb */}
			<Link
				to="/signers"
				className="inline-flex items-center gap-1.5 text-[13px] text-text-dim hover:text-text-muted transition-colors"
			>
				<ArrowLeft className="h-3.5 w-3.5" />
				Accounts
			</Link>

			{/* ================================================================ */}
			{/*  HERO — Account card                                             */}
			{/* ================================================================ */}
			<div className="relative overflow-hidden rounded-2xl border border-border bg-surface">
				{/* Background effects */}
				<div
					className="pointer-events-none absolute inset-0"
					style={{
						backgroundImage:
							'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.018) 1px, transparent 0)',
						backgroundSize: '24px 24px',
					}}
					aria-hidden="true"
				/>
				<div
					className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_80%_20%,rgba(99,102,241,0.04)_0%,transparent_50%)]"
					aria-hidden="true"
				/>

				<div className="relative px-6 py-5">
					{/* Top row: Identity + Balance */}
					<div className="flex items-start justify-between gap-4">
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2.5">
								<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/[0.08] text-text shadow-sm">
									{icon}
								</div>
								<h1 className="text-lg font-bold text-text truncate">{signer.name}</h1>
								<Pill color={status.pill}>{status.label}</Pill>
							</div>
							<div className="mt-2 flex items-center gap-1.5 pl-[46px]">
								<code className="text-[11px] text-text-dim font-mono truncate">
									{signer.ethAddress}
								</code>
								<CopyButton text={signer.ethAddress} className="text-text-dim hover:text-text" />
								<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-surface-hover text-text-dim font-medium ml-0.5">
									{signer.chain}
								</span>
							</div>
						</div>

						<div className="text-right shrink-0">
							<p className="text-[10px] font-medium uppercase tracking-wider text-text-dim">
								Balance
							</p>
							<div className="mt-0.5 text-3xl font-bold tabular-nums tracking-tight text-text">
								{balanceLoading ? (
									<Loader2 className="h-5 w-5 animate-spin text-text-dim ml-auto" />
								) : (
									totalBalance
								)}
							</div>
						</div>
					</div>

					{/* Action buttons */}
					<div className="mt-5 flex items-center gap-2">
						<Link
							to={sendPath}
							className="inline-flex items-center gap-1.5 rounded-full bg-accent px-5 py-2 text-[12px] font-semibold text-accent-foreground shadow-sm transition-all hover:bg-accent-hover hover:shadow active:scale-[0.97]"
						>
							<ArrowUpRight className="h-3.5 w-3.5" />
							Send
						</Link>
						<button
							type="button"
							onClick={() => setReceiveOpen(true)}
							className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-2 text-[12px] font-semibold text-text-muted transition-all hover:bg-surface-hover active:scale-[0.97]"
						>
							<ArrowDownLeft className="h-3.5 w-3.5" />
							Receive
						</button>
						<Link
							to={`/signers/${signerId}/settings`}
							className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3.5 py-2 text-[12px] font-medium text-text-dim transition-all hover:bg-surface-hover hover:text-text-muted active:scale-[0.97]"
						>
							<Settings className="h-3 w-3" />
							Settings
						</Link>

						{networkCount > 0 && (
							<button
								type="button"
								onClick={() => setShowNetworks(!showNetworks)}
								className="ml-auto inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-text-dim transition-all hover:bg-surface-hover hover:text-text-muted"
							>
								{fundedNetworkCount > 0
									? `${fundedNetworkCount}/${networkCount} networks`
									: `${networkCount} networks`}
								<ChevronDown
									className={cn(
										'h-3 w-3 transition-transform duration-200',
										showNetworks && 'rotate-180',
									)}
								/>
							</button>
						)}
					</div>

					{/* Expandable network breakdown */}
					{showNetworks && balanceData?.balances && balanceData.balances.length > 0 && (
						<div className="mt-3 grid grid-cols-2 gap-1">
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
											'flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px] transition-colors',
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
												'font-mono text-[11px] tabular-nums',
												isActive ? 'text-text' : 'text-text-dim',
											)}
										>
											{formatWei(nb.balance)}
										</span>
									</button>
								);
							})}
						</div>
					)}
				</div>
			</div>

			{/* ================================================================ */}
			{/*  STATS                                                           */}
			{/* ================================================================ */}
			<div className="grid grid-cols-2 gap-3">
				<div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
					<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#6366f1]/[0.07]">
						<TrendingUp className="h-4 w-4 text-[#6366f1]/70" />
					</div>
					<div>
						<div className="text-[10px] font-medium uppercase tracking-wider text-text-dim">
							Today's Spend
						</div>
						<div className="mt-0.5 text-base font-bold tabular-nums text-text">
							{activityLoading ? '...' : todaysSpend}
						</div>
					</div>
				</div>
				<div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
					<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/[0.07]">
						<Activity className="h-4 w-4 text-success/70" />
					</div>
					<div>
						<div className="text-[10px] font-medium uppercase tracking-wider text-text-dim">
							Requests Today
						</div>
						<div className="mt-0.5 text-base font-bold tabular-nums text-text">{requestsToday}</div>
					</div>
				</div>
			</div>

			{/* ================================================================ */}
			{/*  TOKENS — flat aggregated list                                    */}
			{/* ================================================================ */}
			<div>
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-[15px] font-semibold text-text">Tokens</h2>
					<Button variant="outline" size="sm" onClick={() => setAddTokenOpen(true)}>
						<Plus className="h-3.5 w-3.5" />
						Add Token
					</Button>
				</div>

				{tokensLoading ? (
					<div className="rounded-xl border border-border bg-surface animate-pulse">
						{Array.from({ length: 3 }, (_, i) => (
							<div
								key={`ts-${i}`}
								className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-0"
							>
								<div className="h-8 w-8 rounded-full bg-surface-hover" />
								<div className="flex-1 space-y-1.5">
									<div className="h-4 w-14 rounded animate-shimmer" />
									<div className="h-3 w-20 rounded animate-shimmer" />
								</div>
								<div className="h-4 w-16 rounded animate-shimmer" />
							</div>
						))}
					</div>
				) : aggregatedTokens.length > 0 ? (
					<div className="rounded-xl border border-border bg-surface overflow-hidden divide-y divide-border">
						{/* Funded tokens always visible */}
						{fundedTokens.map((token, i) => (
							<div
								key={token.symbol}
								className="animate-stagger-in"
								style={{ '--stagger': i } as React.CSSProperties}
							>
								<AggregatedTokenRow
									token={token}
									signerId={signerId}
									multiNetwork={hasMultipleNetworks}
								/>
							</div>
						))}

						{/* Zero-balance tokens — collapsed by default */}
						{zeroTokens.length > 0 && (
							<>
								{showZeroTokens &&
									zeroTokens.map((token) => (
										<AggregatedTokenRow
											key={token.symbol}
											token={token}
											signerId={signerId}
											multiNetwork={hasMultipleNetworks}
										/>
									))}
								<button
									type="button"
									onClick={() => setShowZeroTokens(!showZeroTokens)}
									className="flex w-full items-center justify-center gap-1.5 py-2 text-[11px] font-medium text-text-dim hover:text-text-muted hover:bg-surface-hover transition-colors"
								>
									<ChevronDown
										className={cn(
											'h-3 w-3 transition-transform duration-200',
											showZeroTokens && 'rotate-180',
										)}
									/>
									{showZeroTokens
										? 'Hide zero balances'
										: `${zeroTokens.length} token${zeroTokens.length > 1 ? 's' : ''} with zero balance`}
								</button>
							</>
						)}
					</div>
				) : (
					<div className="rounded-xl border border-dashed border-border bg-surface px-8 py-10 text-center">
						<p className="text-sm font-medium text-text-muted">No tokens tracked yet</p>
						<p className="mt-1.5 text-[12px] text-text-dim max-w-xs mx-auto">
							Add ERC-20 tokens to monitor balances across all your networks in one place.
						</p>
					</div>
				)}
			</div>

			{/* ================================================================ */}
			{/*  RECENT ACTIVITY                                                 */}
			{/* ================================================================ */}
			<div>
				<h2 className="mb-3 text-[15px] font-semibold text-text">Recent Activity</h2>
				{activityLoading ? (
					<div className="rounded-xl border border-border bg-surface p-5 space-y-3 animate-pulse">
						{Array.from({ length: 3 }, (_, i) => (
							<div key={`a-${i}`} className="h-10 rounded-lg bg-surface-hover" />
						))}
					</div>
				) : (
					<ActivityFeed
						entries={activity ?? []}
						showSigner={false}
						maxItems={10}
						viewAllHref={`/audit?signerId=${signerId}`}
					/>
				)}
			</div>

			{/* ================================================================ */}
			{/*  DIALOGS                                                         */}
			{/* ================================================================ */}
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
		</div>
	);
}
