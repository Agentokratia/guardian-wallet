import { ActivityFeed } from '@/components/activity-feed';
import { Addr } from '@/components/ui/addr';
import { Button } from '@/components/ui/button';
import { Dot } from '@/components/ui/dot';
import { useAuditLog } from '@/hooks/use-audit-log';
import { useNetworks } from '@/hooks/use-networks';
import { usePortfolioBalance } from '@/hooks/use-portfolio-balance';
import { useSignerPolicyCounts } from '@/hooks/use-signer-policy-counts';
import { useSigners } from '@/hooks/use-signers';
import { formatTimestamp } from '@/lib/formatters';
import { getTypeIcon, statusConfig } from '@/lib/signer-constants';
import { cn } from '@/lib/utils';
import {
	Activity,
	ArrowUpRight,
	Lock,
	Plus,
	Shield,
	ShieldAlert,
	TrendingUp,
} from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const NETWORK_COLORS: Record<string, string> = {
	mainnet: '#627EEA',
	sepolia: '#627EEA',
	base: '#0052FF',
	'base-sepolia': '#0052FF',
	arbitrum: '#28A0F0',
	'arbitrum-sepolia': '#28A0F0',
};

const TYPE_COLORS: Record<string, string> = {
	ai_agent: '#818cf8',
	deploy_script: '#22c55e',
	backend_service: '#f59e0b',
	team_member: '#6366f1',
	trading_bot: '#ec4899',
	custom: '#8b5cf6',
};

const TYPE_LABELS: Record<string, string> = {
	ai_agent: 'AI Agent',
	deploy_script: 'Deploy',
	backend_service: 'Backend',
	team_member: 'Team',
	trading_bot: 'Trading',
	custom: 'Custom',
	agent: 'Agent',
	bot: 'Bot',
	script: 'Script',
	service: 'Service',
	team: 'Team',
};

/* -------------------------------------------------------------------------- */
/*  SVG Portfolio Chart                                                        */
/* -------------------------------------------------------------------------- */

function PortfolioChart({ className }: { className?: string }) {
	const W = 320;
	const H = 120;
	const points: [number, number][] = [];

	for (let i = 0; i <= 48; i++) {
		const x = (i / 48) * W;
		const y =
			H * 0.7 +
			Math.sin(i * 0.35) * 6 +
			Math.cos(i * 0.6) * 4 +
			Math.sin(i * 1.2) * 2;
		points.push([x, y]);
	}

	const line = points
		.map(
			(p, i) =>
				`${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`,
		)
		.join(' ');
	const area = `${line} L${W},${H} L0,${H} Z`;
	const last = points[points.length - 1];

	return (
		<svg
			viewBox={`0 0 ${W} ${H}`}
			preserveAspectRatio="none"
			className={cn('w-full h-full', className)}
			aria-hidden="true"
			role="img"
		>
			<defs>
				<linearGradient id="chart-area" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor="#6366f1" stopOpacity="0.25" />
					<stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
				</linearGradient>
				<linearGradient id="chart-line" x1="0" y1="0" x2="1" y2="0">
					<stop offset="0%" stopColor="#6366f1" stopOpacity="0.15" />
					<stop offset="60%" stopColor="#6366f1" stopOpacity="0.5" />
					<stop offset="100%" stopColor="#818cf8" stopOpacity="0.9" />
				</linearGradient>
			</defs>

			{/* Grid lines */}
			{[0.2, 0.4, 0.6, 0.8].map((pct) => (
				<line
					key={pct}
					x1="0"
					y1={H * pct}
					x2={W}
					y2={H * pct}
					stroke="#1A1A1A"
					strokeOpacity="0.06"
					strokeWidth="0.5"
				/>
			))}

			{/* Vertical grid lines */}
			{[0.14, 0.28, 0.42, 0.57, 0.71, 0.85].map((pct) => (
				<line
					key={pct}
					x1={W * pct}
					y1="0"
					x2={W * pct}
					y2={H}
					stroke="#1A1A1A"
					strokeOpacity="0.04"
					strokeWidth="0.5"
				/>
			))}

			{/* Area fill */}
			<path d={area} fill="url(#chart-area)" />

			{/* Line */}
			<path
				d={line}
				fill="none"
				stroke="url(#chart-line)"
				strokeWidth="1.5"
				strokeLinejoin="round"
			/>

			{/* Glow dot at current */}
			<circle cx={last[0]} cy={last[1]} r="2.5" fill="#818cf8" />
			<circle cx={last[0]} cy={last[1]} r="7" fill="#818cf8" opacity="0.2">
				<animate
					attributeName="r"
					values="7;12;7"
					dur="3s"
					repeatCount="indefinite"
				/>
				<animate
					attributeName="opacity"
					values="0.2;0.05;0.2"
					dur="3s"
					repeatCount="indefinite"
				/>
			</circle>
		</svg>
	);
}

/* -------------------------------------------------------------------------- */
/*  SVG Network Donut                                                          */
/* -------------------------------------------------------------------------- */

interface DonutSegment {
	name: string;
	color: string;
	value: number;
	label: string;
}

function NetworkDonut({
	segments,
	centerLabel,
}: {
	segments: DonutSegment[];
	centerLabel: string;
}) {
	const C = 2 * Math.PI * 38;
	const total = segments.reduce((sum, s) => sum + s.value, 0);
	const hasValue = total > 0;

	let cumOffset = 0;
	const arcs = segments.map((seg) => {
		const pct = hasValue ? seg.value / total : 1 / segments.length;
		const length = pct * C - 4;
		const offset = cumOffset + 2;
		cumOffset += pct * C;
		return { ...seg, length, offset, pct };
	});

	return (
		<svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden="true">
			{/* Background ring */}
			<circle
				cx="50"
				cy="50"
				r="38"
				fill="none"
				stroke="#E5E5E2"
				strokeOpacity="1"
				strokeWidth="7"
			/>

			{/* Segments */}
			{arcs.map((arc) => (
				<circle
					key={arc.name}
					cx="50"
					cy="50"
					r="38"
					fill="none"
					stroke={arc.color}
					strokeWidth="7"
					strokeDasharray={`${Math.max(arc.length, 0)} ${C - Math.max(arc.length, 0)}`}
					strokeDashoffset={-arc.offset}
					transform="rotate(-90 50 50)"
					strokeLinecap="round"
					opacity={hasValue ? 0.85 : 0.2}
					className="transition-all duration-700"
				/>
			))}

			{/* Center text */}
			<text
				x="50"
				y="47"
				textAnchor="middle"
				fill="#1A1A1A"
				fontSize="10"
				fontWeight="700"
				fontFamily="var(--font-mono, monospace)"
			>
				{centerLabel}
			</text>
			<text
				x="50"
				y="58"
				textAnchor="middle"
				fill="#6B6B6B"
				fontSize="5.5"
				fontWeight="500"
			>
				{hasValue ? 'portfolio' : 'no funds'}
			</text>
		</svg>
	);
}

/* -------------------------------------------------------------------------- */
/*  Account row                                                                */
/* -------------------------------------------------------------------------- */

interface AccountRowProps {
	signer: {
		id: string;
		name: string;
		type: string;
		ethAddress: string;
		status: 'active' | 'paused' | 'revoked';
		createdAt: string;
		lastActiveAt?: string;
	};
	balance?: string;
	policyCount: number;
	lastAction?: string;
}

function AccountRow({
	signer,
	balance,
	policyCount,
	lastAction,
}: AccountRowProps) {
	const status = statusConfig[signer.status];
	const icon = getTypeIcon(signer.type, 'h-3.5 w-3.5');
	const typeColor = TYPE_COLORS[signer.type] ?? '#6366f1';
	const typeLabel = TYPE_LABELS[signer.type] ?? signer.type;
	const lastActiveText = signer.lastActiveAt
		? formatTimestamp(signer.lastActiveAt)
		: lastAction
			? lastAction.replace(/^\S+\s/, '')
			: null;

	return (
		<Link
			to={`/signers/${signer.id}`}
			className={cn(
				'group relative flex items-center gap-4 rounded-lg border border-transparent px-4 py-3 transition-all hover:border-border hover:bg-surface-hover/50',
				signer.status === 'revoked' && 'opacity-40',
			)}
		>
			{/* Left color bar */}
			<div
				className="absolute left-0 top-[25%] bottom-[25%] w-[3px] rounded-full"
				style={{ backgroundColor: typeColor }}
				aria-hidden="true"
			/>

			{/* Icon */}
			<div
				className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
				style={{ backgroundColor: `${typeColor}10` }}
			>
				<span style={{ color: typeColor }}>{icon}</span>
			</div>

			{/* Name + Address + Type */}
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate text-sm font-medium text-text">
						{signer.name}
					</span>
					<span
						className="hidden shrink-0 rounded px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider sm:inline-block"
						style={{ backgroundColor: `${typeColor}12`, color: typeColor }}
					>
						{typeLabel}
					</span>
				</div>
				<div className="mt-0.5 flex items-center gap-2">
					<Addr
						address={signer.ethAddress}
						className="!text-[10px] !px-0 !py-0 !bg-transparent"
					/>
					<Dot color={status.dot} className="h-1.5 w-1.5 shrink-0" />
					<span className={cn(
						'text-[10px] font-medium',
						signer.status === 'active' && 'text-success/70',
						signer.status === 'paused' && 'text-warning/70',
						signer.status === 'revoked' && 'text-danger/70',
					)}>
						{status.label}
					</span>
				</div>
			</div>

			{/* Right side — stats */}
			<div className="flex items-center gap-5 shrink-0">
				{/* Balance */}
				<div className="text-right">
					<div className="text-sm font-semibold tabular-nums text-text">
						{balance || '0 ETH'}
					</div>
					{lastActiveText && (
						<div className="mt-0.5 text-[10px] tabular-nums text-text-dim">
							{lastActiveText}
						</div>
					)}
				</div>

				{/* Policies pill */}
				<Tooltip>
					<TooltipTrigger asChild>
						<div className="hidden items-center gap-1 rounded-md bg-accent-muted/50 px-2 py-1 md:flex cursor-default">
							<Shield className="h-3 w-3 text-accent/50" aria-hidden="true" />
							<span className="text-[11px] tabular-nums text-text-dim">
								{policyCount}
							</span>
						</div>
					</TooltipTrigger>
					<TooltipContent>
						{policyCount === 0
							? 'No policies configured'
							: `${policyCount} active ${policyCount === 1 ? 'policy' : 'policies'}`}
					</TooltipContent>
				</Tooltip>

				{/* Arrow */}
				<ArrowUpRight
					className="h-4 w-4 text-text-dim opacity-0 transition-opacity group-hover:opacity-100"
					aria-hidden="true"
				/>
			</div>
		</Link>
	);
}

/* -------------------------------------------------------------------------- */
/*  Skeleton states                                                            */
/* -------------------------------------------------------------------------- */

function SkeletonRow() {
	return (
		<div className="flex items-center gap-4 rounded-lg px-4 py-3">
			<div className="h-9 w-9 rounded-lg animate-shimmer shrink-0" />
			<div className="flex-1 space-y-1.5">
				<div className="h-3.5 w-28 rounded animate-shimmer" />
				<div className="h-2.5 w-40 rounded animate-shimmer" />
			</div>
			<div className="h-4 w-16 rounded animate-shimmer" />
		</div>
	);
}

function HeroSkeleton() {
	return (
		<div className="relative overflow-hidden rounded-2xl border border-border bg-surface p-8">
			<div className="h-3 w-32 rounded animate-shimmer" />
			<div className="mt-3 h-10 w-48 rounded animate-shimmer" />
			<div className="mt-4 h-3 w-40 rounded animate-shimmer" />
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

export function SignersPage() {
	const { data: signers, isLoading: signersLoading } = useSigners();
	const { data: recentActivity, isLoading: activityLoading } = useAuditLog({
		limit: 20,
	});
	const signerIds = useMemo(
		() => signers?.map((s) => s.id) ?? [],
		[signers],
	);
	const { data: policyCounts } = useSignerPolicyCounts(signerIds);
	const {
		totalFormatted,
		balances,
		networkBalances,
		isLoading: balancesLoading,
	} = usePortfolioBalance(signerIds);
	const { data: networks } = useNetworks();

	const activeCount =
		signers?.filter((s) => s.status === 'active').length ?? 0;
	const totalCount = signers?.length ?? 0;
	const totalPolicies = useMemo(() => {
		if (!policyCounts) return 0;
		return Object.values(policyCounts).reduce((sum, c) => sum + c, 0);
	}, [policyCounts]);
	const blockedToday = useMemo(() => {
		if (!recentActivity) return 0;
		const todayStart = new Date();
		todayStart.setHours(0, 0, 0, 0);
		return recentActivity.filter(
			(a) =>
				a.status === 'blocked' && new Date(a.createdAt) >= todayStart,
		).length;
	}, [recentActivity]);
	const totalRequests = recentActivity?.length ?? 0;

	const signerNames =
		signers?.reduce(
			(acc, s) => {
				acc[s.id] = s.name;
				return acc;
			},
			{} as Record<string, string>,
		) ?? {};

	// Enabled networks from the networks table
	const enabledNetworks = useMemo(() => {
		if (!networks) return [];
		return networks.filter((n) => n.enabled).map((n) => ({
			name: n.name,
			displayName: n.displayName,
			color: NETWORK_COLORS[n.name] ?? '#6366f1',
		}));
	}, [networks]);

	// Aggregate balances across all signers per network for donut chart
	const networkSegments = useMemo<DonutSegment[]>(() => {
		if (enabledNetworks.length === 0) return [];

		const totals = new Map<string, bigint>();
		for (const entries of Object.values(networkBalances)) {
			for (const entry of entries) {
				const prev = totals.get(entry.network) ?? 0n;
				totals.set(entry.network, prev + BigInt(entry.balance || '0'));
			}
		}

		return enabledNetworks.map((n) => ({
			name: n.name,
			label: n.displayName,
			color: n.color,
			value: Number(totals.get(n.name) ?? 0n),
		}));
	}, [enabledNetworks, networkBalances]);

	// Derive the last action per signer from audit log
	const lastActionBySigner = useMemo(() => {
		const map: Record<string, string> = {};
		if (!recentActivity) return map;
		for (const entry of recentActivity) {
			if (!map[entry.signerId]) {
				map[entry.signerId] = `${entry.requestType} ${formatTimestamp(entry.createdAt)}`;
			}
		}
		return map;
	}, [recentActivity]);

	const isHeroLoading = balancesLoading && signersLoading;

	return (
		<div className="space-y-6">
			{/* ---------------------------------------------------------------- */}
			{/*  Hero — Balance + Chart                                          */}
			{/* ---------------------------------------------------------------- */}
			{isHeroLoading ? (
				<HeroSkeleton />
			) : (
				<div className="relative overflow-hidden rounded-2xl border border-border bg-surface">
					{/* Background effects */}
					<div
						className="pointer-events-none absolute inset-0"
						style={{
							backgroundImage:
								'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.025) 1px, transparent 0)',
							backgroundSize: '20px 20px',
						}}
						aria-hidden="true"
					/>
					<div
						className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_75%_40%,rgba(99,102,241,0.04)_0%,transparent_55%)]"
						aria-hidden="true"
					/>

					<div className="relative grid grid-cols-1 lg:grid-cols-5">
						{/* Left: balance + info */}
						<div className="flex flex-col justify-center p-8 lg:col-span-2">
							<p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-text-dim">
								Total Portfolio Balance
							</p>
							<h1 className="mt-2 text-4xl font-bold tabular-nums tracking-tight text-text">
								{totalFormatted}
							</h1>

							{/* Account stats */}
							<div className="mt-3 flex items-center gap-3 text-[13px] text-text-dim">
								<span className="tabular-nums">
									{totalCount} account
									{totalCount !== 1 ? 's' : ''}
								</span>
								<span className="text-border">|</span>
								<span className="flex items-center gap-1">
									<span className="inline-block h-1.5 w-1.5 rounded-full bg-success/70" />
									<span className="tabular-nums">
										{activeCount} active
									</span>
								</span>
							</div>

							{/* Network pills */}
							{enabledNetworks.length > 0 && (
								<div className="mt-4 flex flex-wrap gap-1.5">
									{enabledNetworks.map((net) => (
										<div
											key={net.name}
											className="flex items-center gap-1.5 rounded-full bg-surface-hover/50 px-2.5 py-1"
										>
											<span
												className="inline-block h-2 w-2 rounded-full"
												style={{
													backgroundColor: net.color,
												}}
											/>
											<span className="text-[11px] text-text-muted">
												{net.displayName}
											</span>
										</div>
									))}
								</div>
							)}

							{/* Trust signal */}
							<div className="mt-5 flex items-center gap-1.5 text-[10px] text-text-dim">
								<Lock
									className="h-3 w-3"
									aria-hidden="true"
								/>
								<span>
									2-of-3 threshold cryptography
								</span>
							</div>
						</div>

						{/* Right: chart */}
						<div className="relative lg:col-span-3">
							<div className="h-[200px] w-full">
								<PortfolioChart />
							</div>
							{/* Time labels under chart */}
							<div className="absolute bottom-2 left-4 right-4 flex justify-between text-[9px] text-text-dim">
								<span>7d ago</span>
								<span>5d</span>
								<span>3d</span>
								<span>1d</span>
								<span>now</span>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* ---------------------------------------------------------------- */}
			{/*  Middle row — Donut + Stats                                      */}
			{/* ---------------------------------------------------------------- */}
			<div className="grid grid-cols-1 gap-4 md:grid-cols-12">
				{/* Network Distribution */}
				<div className="rounded-xl border border-border bg-surface p-5 md:col-span-4">
					<h2 className="text-xs font-medium uppercase tracking-wider text-text-dim">
						Networks
					</h2>

					<div className="mt-4 flex items-center gap-5">
						<div className="h-[110px] w-[110px] shrink-0">
							<NetworkDonut
								segments={networkSegments}
								centerLabel={
									enabledNetworks.length > 0
										? String(enabledNetworks.length)
										: '--'
								}
							/>
						</div>
						<div className="min-w-0 space-y-2.5">
							{networkSegments.length > 0 ? (
								networkSegments.map((seg) => (
									<div
										key={seg.name}
										className="flex items-center gap-2"
									>
										<span
											className="inline-block h-2 w-2 shrink-0 rounded-full"
											style={{
												backgroundColor: seg.color,
											}}
										/>
										<span className="truncate text-xs text-text-muted">
											{seg.label}
										</span>
										<span className="ml-auto text-xs tabular-nums text-text-dim">
											{seg.value}
										</span>
									</div>
								))
							) : (
								<span className="text-xs text-text-dim">
									No accounts yet
								</span>
							)}
						</div>
					</div>
				</div>

				{/* Stats grid */}
				<div className="grid grid-cols-2 gap-3 md:col-span-8 lg:grid-cols-4">
					<div className="flex flex-col justify-between rounded-xl border border-border bg-surface p-4 card-hover">
						<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/[0.06] text-accent/60">
							<Shield className="h-4 w-4" />
						</div>
						<div className="mt-3">
							<div className="text-2xl font-bold tabular-nums text-text">
								{totalPolicies}
							</div>
							<div className="mt-0.5 text-[11px] text-text-dim">
								Active Policies
							</div>
						</div>
					</div>

					<div className="flex flex-col justify-between rounded-xl border border-border bg-surface p-4 card-hover">
						<div
							className={cn(
								'flex h-8 w-8 items-center justify-center rounded-lg',
								blockedToday > 0
									? 'bg-danger/10 text-danger'
									: 'bg-accent/[0.06] text-text-dim',
							)}
						>
							<ShieldAlert className="h-4 w-4" />
						</div>
						<div className="mt-3">
							<div className="text-2xl font-bold tabular-nums text-text">
								{blockedToday}
							</div>
							<div className="mt-0.5 text-[11px] text-text-dim">
								Blocked Today
							</div>
						</div>
					</div>

					<div className="flex flex-col justify-between rounded-xl border border-border bg-surface p-4 card-hover">
						<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/[0.06] text-text-dim">
							<Activity className="h-4 w-4" />
						</div>
						<div className="mt-3">
							<div className="text-2xl font-bold tabular-nums text-text">
								{totalRequests}
							</div>
							<div className="mt-0.5 text-[11px] text-text-dim">
								Recent Requests
							</div>
						</div>
					</div>

					<div className="flex flex-col justify-between rounded-xl border border-border bg-surface p-4 card-hover">
						<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10 text-success/60">
							<TrendingUp className="h-4 w-4" />
						</div>
						<div className="mt-3">
							<div className="text-2xl font-bold tabular-nums text-text">
								{activeCount}/{totalCount}
							</div>
							<div className="mt-0.5 text-[11px] text-text-dim">
								Accounts Active
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* ---------------------------------------------------------------- */}
			{/*  Accounts list                                                   */}
			{/* ---------------------------------------------------------------- */}
			<section>
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-[15px] font-semibold text-text">
						Accounts
					</h2>
					<Button size="sm" asChild>
						<Link to="/signers/new">
							<Plus className="h-4 w-4" />
							New Account
						</Link>
					</Button>
				</div>

				{signersLoading ? (
					<div className="space-y-px rounded-xl border border-border bg-surface overflow-hidden">
						{Array.from({ length: 3 }, (_, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
							<SkeletonRow key={`sk-${i}`} />
						))}
					</div>
				) : signers && signers.length > 0 ? (
					<div className="space-y-1">
							{signers.map((signer, i) => (
								<div
									key={signer.id}
									className="animate-stagger-in"
									style={{ '--stagger': i } as React.CSSProperties}
								>
									<AccountRow
										signer={signer}
										balance={balances[signer.id]}
										policyCount={
											policyCounts?.[signer.id] ?? 0
										}
										lastAction={
											lastActionBySigner[signer.id]
										}
									/>
								</div>
							))}
					</div>
				) : (
					<div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface px-8 py-16 text-center">
						<div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/[0.06] text-text-muted animate-float">
							<Shield className="h-7 w-7" />
						</div>
						<h3 className="mt-5 text-base font-semibold text-text">
							Create Your First Account
						</h3>
						<p className="mt-1.5 max-w-sm text-sm text-text-muted">
							Each account is protected by threshold
							cryptography. The private key is split into 3
							shares — no single device ever holds the full
							key.
						</p>
						<Button asChild className="mt-5">
							<Link to="/signers/new">
								<Plus className="h-4 w-4" />
								Create Account
							</Link>
						</Button>
						<div className="mt-4 flex items-center gap-1.5 text-[11px] text-text-dim">
							<Lock className="h-3 w-3" aria-hidden="true" />
							<span>2-of-3 threshold ECDSA</span>
						</div>
					</div>
				)}
			</section>

			{/* ---------------------------------------------------------------- */}
			{/*  Recent Activity                                                 */}
			{/* ---------------------------------------------------------------- */}
			{(recentActivity?.length ?? 0) > 0 && (
				<section>
					<div className="mb-3 flex items-center justify-between">
						<h2 className="text-[15px] font-semibold text-text">
							Recent Activity
						</h2>
						<Link
							to="/audit"
							className="text-xs text-text-muted transition-colors hover:text-accent"
						>
							View all
						</Link>
					</div>
					{activityLoading ? (
						<div className="rounded-xl border border-border bg-surface p-8 text-center animate-pulse">
							<div className="mx-auto h-4 w-32 rounded bg-surface-hover" />
						</div>
					) : (
						<ActivityFeed
							entries={recentActivity ?? []}
							signerNames={signerNames}
							showSigner
							maxItems={5}
							viewAllHref="/audit"
						/>
					)}
				</section>
			)}
		</div>
	);
}
