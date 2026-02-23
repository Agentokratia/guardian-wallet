import {
	type CertificationScore,
	type CertificationTier,
	TIER_COLORS,
} from '@/lib/certification-score';
import { cn } from '@/lib/utils';
import {
	ArrowRight,
	ChevronDown,
	DollarSign,
	ExternalLink,
	Gauge,
	Globe,
	Lightbulb,
	Settings,
	Shield,
	ShieldCheck,
	Zap,
} from 'lucide-react';
import { useMemo, useState } from 'react';

/* ========================================================================== */
/*  Score Ring (SVG)                                                           */
/* ========================================================================== */

const RING_RADIUS = 40;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function ScoreRing({
	score,
	tier,
	size = 100,
}: {
	score: number;
	tier: CertificationTier;
	size?: number;
}) {
	const offset = RING_CIRCUMFERENCE * (1 - score / 100);
	const colors = TIER_COLORS[tier];

	return (
		<div className="relative" style={{ width: size, height: size }}>
			<svg width={size} height={size} viewBox="0 0 100 100" className="-rotate-90">
				{/* Background track */}
				<circle
					cx="50"
					cy="50"
					r={RING_RADIUS}
					fill="none"
					stroke="currentColor"
					strokeWidth="6"
					className="text-border"
				/>
				{/* Score arc */}
				<circle
					cx="50"
					cy="50"
					r={RING_RADIUS}
					fill="none"
					strokeWidth="6"
					strokeLinecap="round"
					strokeDasharray={RING_CIRCUMFERENCE}
					strokeDashoffset={offset}
					className={cn(colors.ring, 'transition-[stroke-dashoffset] duration-1000 ease-out')}
				/>
			</svg>
			{/* Center text */}
			<div className="absolute inset-0 flex flex-col items-center justify-center">
				<span className="text-2xl font-bold tabular-nums text-text leading-none">{score}</span>
				<span className="text-[9px] font-medium uppercase tracking-wider text-text-dim mt-0.5">
					/ 100
				</span>
			</div>
		</div>
	);
}

/* ========================================================================== */
/*  Pillar bar                                                                 */
/* ========================================================================== */

function PillarBar({
	label,
	value,
	max,
	tier,
}: {
	label: string;
	value: number;
	max: number;
	tier: CertificationTier;
}) {
	const pct = max > 0 ? (value / max) * 100 : 0;
	const colors = TIER_COLORS[tier];

	return (
		<div className="space-y-1">
			<div className="flex items-center justify-between">
				<span className="text-[11px] font-medium text-text-muted">{label}</span>
				<span className="text-[11px] font-bold tabular-nums text-text">
					{value}/{max}
				</span>
			</div>
			<div className="h-1.5 rounded-full bg-border overflow-hidden">
				<div
					className={cn('h-full rounded-full transition-[width] duration-700 ease-out', colors.dot)}
					style={{ width: `${pct}%` }}
				/>
			</div>
		</div>
	);
}

/* ========================================================================== */
/*  Posture detail grid                                                        */
/* ========================================================================== */

const POSTURE_CATEGORIES = [
	{
		key: 'networkControl' as const,
		label: 'Network',
		max: 4,
		icon: Globe,
		hint: 'Restrict to specific chains',
	},
	{
		key: 'contractControl' as const,
		label: 'Contracts',
		max: 11,
		icon: Shield,
		hint: 'Whitelist allowed contracts',
	},
	{
		key: 'spendingLimits' as const,
		label: 'Limits',
		max: 14,
		icon: DollarSign,
		hint: 'Set per-tx, daily, or monthly caps',
	},
	{
		key: 'rateControls' as const,
		label: 'Rate',
		max: 6,
		icon: Gauge,
		hint: 'Add rate limits or operating hours',
	},
	{
		key: 'defiSafety' as const,
		label: 'DeFi',
		max: 7,
		icon: Zap,
		hint: 'Block unlimited approvals',
	},
	{
		key: 'advanced' as const,
		label: 'Advanced',
		max: 3,
		icon: Settings,
		hint: 'Restrict functions or IPs',
	},
];

function PostureDetail({ cert }: { cert: CertificationScore }) {
	const colors = TIER_COLORS[cert.tier];

	return (
		<div className="grid grid-cols-3 gap-2">
			{POSTURE_CATEGORIES.map(({ key, label, max, icon: Icon, hint }) => {
				const value = cert.policyPosture[key];
				const active = value > 0;
				const full = value >= max;
				return (
					<div
						key={key}
						className={cn(
							'rounded-lg px-2.5 py-2 border transition-colors',
							active ? `${colors.bg} ${colors.border}` : 'bg-surface border-border',
						)}
					>
						<div className="flex items-center gap-2">
							<Icon
								className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-text' : 'text-text-dim')}
							/>
							<div className="min-w-0">
								<div
									className={cn('text-[10px] font-medium', active ? 'text-text' : 'text-text-dim')}
								>
									{label}
								</div>
								<div className="text-[10px] tabular-nums text-text-muted">
									{value}/{max}
								</div>
							</div>
						</div>
						{!active && (
							<div className="mt-1 text-[8px] text-text-dim/70 leading-snug">
								+{max} pts &middot; {hint}
							</div>
						)}
						{active && !full && (
							<div className="mt-1 text-[8px] leading-snug text-text-muted">
								+{max - value} pts available
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

/* ========================================================================== */
/*  Quick stat                                                                 */
/* ========================================================================== */

function QuickStat({ label, value }: { label: string; value: string | number }) {
	return (
		<div className="text-center">
			<div className="text-sm font-bold tabular-nums text-text">{value}</div>
			<div className="text-[9px] font-medium uppercase tracking-wider text-text-dim mt-0.5">
				{label}
			</div>
		</div>
	);
}

/* ========================================================================== */
/*  Next-step hint                                                             */
/* ========================================================================== */

/** Finds the single highest-impact action the user can take right now. */
function getNextStep(cert: CertificationScore): { text: string; pts: number } | null {
	const p = cert.policyPosture;

	// Ordered by point impact (descending)
	const opportunities: { text: string; pts: number; current: number }[] = [
		{
			text: 'Set spending limits (per-tx, daily, or monthly)',
			pts: p.spendingLimits === 0 ? 14 : 14 - p.spendingLimits,
			current: p.spendingLimits,
		},
		{
			text: 'Whitelist allowed contracts',
			pts: p.contractControl === 0 ? 11 : 11 - p.contractControl,
			current: p.contractControl,
		},
		{
			text: 'Add rate limits or operating hours',
			pts: p.rateControls === 0 ? 6 : 6 - p.rateControls,
			current: p.rateControls,
		},
		{
			text: 'Enable DeFi safety checks',
			pts: p.defiSafety === 0 ? 7 : 7 - p.defiSafety,
			current: p.defiSafety,
		},
		{
			text: 'Restrict to specific chains',
			pts: p.networkControl === 0 ? 4 : 0,
			current: p.networkControl,
		},
		{
			text: 'Add function or IP restrictions',
			pts: p.advanced === 0 ? 3 : 3 - p.advanced,
			current: p.advanced,
		},
	];

	// Filter to items with remaining points, sort by impact
	const available = opportunities.filter((o) => o.pts > 0).sort((a, b) => b.pts - a.pts);
	if (available.length === 0) return null;
	return { text: available[0].text, pts: available[0].pts };
}

function NextStepHint({ cert }: { cert: CertificationScore }) {
	const next = useMemo(() => getNextStep(cert), [cert]);
	if (!next) return null;

	const nextTier =
		cert.score + next.pts >= 90
			? 'Certified'
			: cert.score + next.pts >= 70
				? 'Verified'
				: cert.score + next.pts >= 40
					? 'Provisional'
					: null;
	const wouldUpgrade = nextTier && nextTier !== cert.tierLabel;

	return (
		<div className="mt-3 flex items-start gap-2 rounded-lg border border-accent/15 bg-accent/[0.04] px-3 py-2.5">
			<Lightbulb className="h-3.5 w-3.5 shrink-0 text-accent mt-0.5" />
			<div className="min-w-0">
				<div className="text-[11px] text-text-muted leading-relaxed">
					<span className="font-medium text-text">Next step:</span> {next.text}
				</div>
				<div className="mt-0.5 flex items-center gap-1.5 text-[10px]">
					<span className="font-semibold text-accent">+{next.pts} pts</span>
					{wouldUpgrade && (
						<>
							<ArrowRight className="h-2.5 w-2.5 text-text-dim" />
							<span className="font-semibold text-success">{nextTier}</span>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

/* ========================================================================== */
/*  Main Card                                                                  */
/* ========================================================================== */

interface CertificationCardProps {
	cert: CertificationScore;
	address: string;
	name: string;
	onGetBadge?: () => void;
}

export function CertificationCard({ cert, address, name, onGetBadge }: CertificationCardProps) {
	const [expanded, setExpanded] = useState(false);
	const colors = TIER_COLORS[cert.tier];

	return (
		<div
			className={cn(
				'overflow-hidden rounded-xl border transition-colors',
				colors.border,
				'bg-surface',
			)}
		>
			{/* ──── Top bar with tier color ──── */}
			<div className={cn('h-1', colors.dot)} />

			<div className="px-5 py-4">
				{/* ──── Header: ring + info ──── */}
				<div className="flex items-center gap-5">
					<ScoreRing score={cert.score} tier={cert.tier} size={88} />

					<div className="flex-1 min-w-0">
						{/* Tier badge */}
						<div className="flex items-center gap-2">
							<span
								className={cn(
									'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
									colors.bg,
									colors.text,
								)}
							>
								<ShieldCheck className="h-3 w-3" />
								{cert.tierLabel}
							</span>
							<span className="text-[10px] text-text-dim">by Agentokratia</span>
						</div>

						{/* Description */}
						<p className="mt-1.5 text-[12px] text-text-muted leading-relaxed">
							{cert.tierDescription}
						</p>

						{/* Quick stats row */}
						<div className="mt-3 flex items-center gap-5">
							<QuickStat label="Guardrails" value={cert.activeGuardrails} />
							<QuickStat
								label="Safe Rate"
								value={cert.compliance.totalRequests > 0 ? `${cert.compliance.safeRate}%` : 'N/A'}
							/>
							<QuickStat
								label="Age"
								value={cert.maturity.ageDays > 0 ? `${cert.maturity.ageDays}d` : 'New'}
							/>
							<QuickStat label="Signed" value={cert.compliance.totalRequests} />
						</div>
					</div>
				</div>

				{/* ──── Pillars ──── */}
				<div className="mt-4 grid grid-cols-3 gap-4">
					<PillarBar
						label="Policy Posture"
						value={cert.policyPosture.total}
						max={cert.policyPosture.max}
						tier={cert.tier}
					/>
					<PillarBar
						label="Compliance"
						value={cert.compliance.score}
						max={cert.compliance.max}
						tier={cert.tier}
					/>
					<PillarBar
						label="Maturity"
						value={cert.maturity.total}
						max={cert.maturity.max}
						tier={cert.tier}
					/>
				</div>

				{/* ──── Next-step hint ──── */}
				{cert.score < 100 && <NextStepHint cert={cert} />}

				{/* ──── Expandable breakdown ──── */}
				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-colors"
				>
					{expanded ? 'Hide breakdown' : 'View breakdown'}
					<ChevronDown
						className={cn('h-3 w-3 transition-transform duration-200', expanded && 'rotate-180')}
					/>
				</button>

				{expanded && (
					<div className="mt-2 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
						{/* Policy posture detail */}
						<div>
							<h4 className="text-[11px] font-semibold text-text mb-2">
								Policy Posture — {cert.policyPosture.total}/{cert.policyPosture.max}
							</h4>
							<PostureDetail cert={cert} />
						</div>

						{/* Compliance detail */}
						<div className="border-t border-border pt-3">
							<h4 className="text-[11px] font-semibold text-text">
								Compliance Record — {cert.compliance.score}/{cert.compliance.max}
							</h4>
							<p className="text-[9px] text-text-dim mt-0.5 mb-2">
								{cert.compliance.totalRequests === 0
									? 'No transactions yet. Score starts at 18/35 and improves with a clean history.'
									: cert.compliance.safeRate >= 99
										? 'Excellent. Keep your approval rate above 99% for maximum score.'
										: `Approval rate is ${cert.compliance.safeRate}%. Reach 99%+ for full 35 points.`}
							</p>
							<div className="grid grid-cols-3 gap-3">
								<div className="rounded-lg bg-surface px-3 py-2">
									<div className="text-sm font-bold tabular-nums text-text">
										{cert.compliance.approved}
									</div>
									<div className="text-[9px] font-medium uppercase tracking-wider text-success">
										Passed
									</div>
								</div>
								<div className="rounded-lg bg-surface px-3 py-2">
									<div className="text-sm font-bold tabular-nums text-text">
										{cert.compliance.blocked}
									</div>
									<div className="text-[9px] font-medium uppercase tracking-wider text-danger">
										Blocked
									</div>
								</div>
								<div className="rounded-lg bg-surface px-3 py-2">
									<div className="text-sm font-bold tabular-nums text-text">
										{cert.compliance.totalRequests > 0 ? `${cert.compliance.safeRate}%` : '—'}
									</div>
									<div className="text-[9px] font-medium uppercase tracking-wider text-text-dim">
										Safe Rate
									</div>
								</div>
							</div>
						</div>

						{/* Maturity detail */}
						<div className="border-t border-border pt-3">
							<h4 className="text-[11px] font-semibold text-text">
								Operational Maturity — {cert.maturity.total}/{cert.maturity.max}
							</h4>
							<p className="text-[9px] text-text-dim mt-0.5 mb-2">
								Improves with time and usage. +1 pt per week (max 8), +1 pt per 25 transactions (max
								8).
							</p>
							<div className="grid grid-cols-3 gap-3">
								<div className="rounded-lg bg-surface px-3 py-2">
									<div className="text-sm font-bold tabular-nums text-text">
										{cert.maturity.ageScore}/8
									</div>
									<div className="text-[9px] font-medium uppercase tracking-wider text-text-dim">
										Age ({cert.maturity.ageDays}d)
									</div>
								</div>
								<div className="rounded-lg bg-surface px-3 py-2">
									<div className="text-sm font-bold tabular-nums text-text">
										{cert.maturity.volumeScore}/8
									</div>
									<div className="text-[9px] font-medium uppercase tracking-wider text-text-dim">
										Volume ({cert.maturity.volume})
									</div>
								</div>
								<div className="rounded-lg bg-surface px-3 py-2">
									<div className="text-sm font-bold tabular-nums text-text">
										{cert.maturity.recencyScore}/4
									</div>
									<div className="text-[9px] font-medium uppercase tracking-wider text-text-dim">
										Recency
									</div>
								</div>
							</div>
						</div>

						{/* Badge CTA */}
						{onGetBadge && (
							<div className="border-t border-border pt-3">
								<button
									type="button"
									onClick={onGetBadge}
									className={cn(
										'flex w-full items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-[12px] font-semibold transition-colors hover:brightness-125',
										colors.bg,
										colors.text,
									)}
								>
									<ExternalLink className="h-3.5 w-3.5" />
									Get embeddable badge
								</button>
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
