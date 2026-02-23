import type { CertificationScore, CertificationTier } from '@/lib/certification-score';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, Copy, ShieldCheck } from 'lucide-react';
import { useCallback, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Tier tokens                                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

const S: Record<
	CertificationTier,
	{
		bar: string;
		score: string;
		ring: string;
		ringTrack: string;
		label: string;
		labelBg: string;
		pillBorder: string;
	}
> = {
	certified: {
		bar: 'bg-zinc-200',
		score: 'text-zinc-100',
		ring: 'stroke-zinc-200',
		ringTrack: 'stroke-zinc-700/40',
		label: 'text-zinc-100',
		labelBg: 'bg-zinc-200/10',
		pillBorder: 'border-zinc-300/30',
	},
	verified: {
		bar: 'bg-emerald-500',
		score: 'text-emerald-400',
		ring: 'stroke-emerald-400',
		ringTrack: 'stroke-emerald-900/40',
		label: 'text-emerald-400',
		labelBg: 'bg-emerald-500/10',
		pillBorder: 'border-emerald-500/30',
	},
	provisional: {
		bar: 'bg-amber-500',
		score: 'text-amber-400',
		ring: 'stroke-amber-400',
		ringTrack: 'stroke-amber-900/40',
		label: 'text-amber-400',
		labelBg: 'bg-amber-500/10',
		pillBorder: 'border-amber-500/30',
	},
	uncertified: {
		bar: 'bg-zinc-600',
		score: 'text-zinc-400',
		ring: 'stroke-zinc-500',
		ringTrack: 'stroke-zinc-800',
		label: 'text-zinc-400',
		labelBg: 'bg-zinc-500/10',
		pillBorder: 'border-zinc-500/30',
	},
};

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Badge variants                                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */

function BadgeCard({
	tier,
	score,
	name,
	guardrails,
}: {
	tier: CertificationTier;
	score: number;
	name: string;
	guardrails: number;
}) {
	const s = S[tier];
	const label = tier.charAt(0).toUpperCase() + tier.slice(1);
	return (
		<div className="w-[220px] overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/80">
			<div className={cn('h-[2px]', s.bar)} />
			<div className="px-3.5 py-3">
				<div className="flex items-center gap-3">
					<div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
						<svg className="absolute inset-0" viewBox="0 0 40 40">
							<circle
								cx="20"
								cy="20"
								r="16"
								fill="none"
								strokeWidth="2.5"
								className={s.ringTrack}
							/>
							<circle
								cx="20"
								cy="20"
								r="16"
								fill="none"
								strokeWidth="2.5"
								strokeDasharray={`${(score / 100) * 100.5} 100.5`}
								strokeLinecap="round"
								transform="rotate(-90 20 20)"
								className={s.ring}
								stroke="currentColor"
							/>
						</svg>
						<span className={cn('text-[13px] font-bold tabular-nums', s.score)}>{score}</span>
					</div>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-1.5">
							<ShieldCheck className={cn('h-3 w-3', s.label)} />
							<span className={cn('text-[11px] font-bold tracking-wide', s.label)}>{label}</span>
						</div>
						<div className="mt-0.5 text-[9px] text-zinc-500 truncate">{name}</div>
					</div>
				</div>
			</div>
			<div className="flex items-center justify-between border-t border-zinc-800/80 px-3.5 py-1.5">
				<span className="text-[8px] text-zinc-600">
					{guardrails > 0 ? `${guardrails} guardrails` : 'No guardrails'}
				</span>
				<span className="text-[7px] font-bold tracking-[0.15em] text-zinc-600">AGENTOKRATIA</span>
			</div>
		</div>
	);
}

function BadgeShield({ tier, score }: { tier: CertificationTier; score: number }) {
	const s = S[tier];
	const label = tier.charAt(0).toUpperCase() + tier.slice(1);
	return (
		<div className="inline-flex items-center overflow-hidden rounded-md border border-zinc-800 bg-zinc-900/80">
			<div className="flex items-center gap-2 px-3 py-2">
				<ShieldCheck className={cn('h-3.5 w-3.5', s.label)} />
				<div>
					<div className={cn('text-[11px] font-bold leading-none tracking-wide', s.label)}>
						{label}
					</div>
					<div className="mt-0.5 text-[8px] text-zinc-500">{score}/100</div>
				</div>
			</div>
			<div className="flex items-center border-l border-zinc-800 px-2.5 py-2">
				<span className="text-[7px] font-bold tracking-[0.15em] text-zinc-600">AGENTOKRATIA</span>
			</div>
		</div>
	);
}

function BadgeCompact({
	tier,
	score,
	guardrails,
}: { tier: CertificationTier; score: number; guardrails: number }) {
	const s = S[tier];
	const label = tier.charAt(0).toUpperCase() + tier.slice(1);
	return (
		<div className="inline-flex items-center overflow-hidden rounded-md border border-zinc-800 bg-zinc-900/80">
			<div
				className={cn('flex items-center gap-1.5 border-r border-zinc-800 px-2 py-1', s.labelBg)}
			>
				<ShieldCheck className={cn('h-3 w-3', s.label)} />
				<span className={cn('text-[10px] font-bold', s.label)}>{label}</span>
			</div>
			<div className="flex items-center gap-2 px-2 py-1">
				<span className="text-[11px] font-bold tabular-nums text-zinc-200">{score}</span>
				<span className="text-[8px] text-zinc-600">{guardrails} guardrails</span>
			</div>
		</div>
	);
}

function BadgePill({ tier, score }: { tier: CertificationTier; score: number }) {
	const s = S[tier];
	const label = tier.charAt(0).toUpperCase() + tier.slice(1);
	return (
		<span
			className={cn(
				'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5',
				s.pillBorder,
				s.labelBg,
			)}
		>
			<ShieldCheck className={cn('h-2.5 w-2.5', s.label)} />
			<span className={cn('text-[10px] font-bold', s.label)}>{label}</span>
			<span className="text-[10px] font-bold tabular-nums text-zinc-300">{score}</span>
		</span>
	);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Copy button                                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

function CopyBtn({ text, label }: { text: string; label: string }) {
	const [copied, setCopied] = useState(false);
	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [text]);

	return (
		<button
			type="button"
			onClick={handleCopy}
			className={cn(
				'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] font-medium transition-colors',
				copied
					? 'border-success/30 bg-success/5 text-success'
					: 'border-border text-text-dim hover:text-text-muted hover:bg-surface-hover',
			)}
		>
			{copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
			{copied ? 'Copied' : label}
		</button>
	);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Main                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

const BADGE_STYLES = ['Card', 'Shield', 'Compact', 'Pill'] as const;
type BadgeStyle = (typeof BADGE_STYLES)[number];

interface EmbeddableBadgesProps {
	cert: CertificationScore;
	address: string;
	name: string;
}

export function EmbeddableBadges({ cert, address, name }: EmbeddableBadgesProps) {
	const [activeStyle, setActiveStyle] = useState<BadgeStyle>('Card');
	const [showCode, setShowCode] = useState(false);
	const shortAddr = `${address.slice(0, 6)}...${address.slice(-4)}`;

	const badgeUrl = `https://guardian.agentokratia.com/badge/${address}`;
	const profileUrl = `https://guardian.agentokratia.com/agent/${address}`;

	const embedCodes: Record<BadgeStyle, { html: string; markdown: string }> = {
		Card: {
			html: `<a href="${profileUrl}"><img src="${badgeUrl}?style=card" alt="${name} - Agentokratia ${cert.tierLabel}" width="220" /></a>`,
			markdown: `[![${name} - Agentokratia ${cert.tierLabel}](${badgeUrl}?style=card)](${profileUrl})`,
		},
		Shield: {
			html: `<a href="${profileUrl}"><img src="${badgeUrl}?style=shield" alt="${name} - ${cert.tierLabel} ${cert.score}" /></a>`,
			markdown: `[![${name} - ${cert.tierLabel} ${cert.score}](${badgeUrl}?style=shield)](${profileUrl})`,
		},
		Compact: {
			html: `<a href="${profileUrl}"><img src="${badgeUrl}?style=compact" alt="${name} - ${cert.tierLabel} ${cert.score}" /></a>`,
			markdown: `[![${name} - ${cert.tierLabel} ${cert.score}](${badgeUrl}?style=compact)](${profileUrl})`,
		},
		Pill: {
			html: `<a href="${profileUrl}"><img src="${badgeUrl}?style=pill" alt="${cert.tierLabel} ${cert.score}" /></a>`,
			markdown: `[![${cert.tierLabel} ${cert.score}](${badgeUrl}?style=pill)](${profileUrl})`,
		},
	};

	const currentCodes = embedCodes[activeStyle];

	return (
		<div>
			{/* ── Header ─────────────────────────────────────────────── */}
			<div className="px-5 pt-5 pb-3">
				<h3 className="text-[14px] font-semibold text-text">Certification Badge</h3>
				<p className="mt-0.5 text-[11px] text-text-dim">Embed in your README or website.</p>
			</div>

			{/* ── Style tabs — centered ──────────────────────────────── */}
			<div className="flex justify-center px-5 pb-3">
				<div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
					{BADGE_STYLES.map((style) => (
						<button
							key={style}
							type="button"
							onClick={() => setActiveStyle(style)}
							className={cn(
								'rounded-md px-3 py-1 text-[10px] font-medium transition-colors',
								activeStyle === style
									? 'bg-background text-text shadow-sm'
									: 'text-text-dim hover:text-text-muted',
							)}
						>
							{style}
						</button>
					))}
				</div>
			</div>

			{/* ── Badge preview — tight, dark ────────────────────────── */}
			<div className="mx-5 flex items-center justify-center rounded-lg border border-border bg-[#08080c] px-4 py-5">
				{activeStyle === 'Card' && (
					<BadgeCard
						tier={cert.tier}
						score={cert.score}
						name={`${name} (${shortAddr})`}
						guardrails={cert.activeGuardrails}
					/>
				)}
				{activeStyle === 'Shield' && <BadgeShield tier={cert.tier} score={cert.score} />}
				{activeStyle === 'Compact' && (
					<BadgeCompact tier={cert.tier} score={cert.score} guardrails={cert.activeGuardrails} />
				)}
				{activeStyle === 'Pill' && <BadgePill tier={cert.tier} score={cert.score} />}
			</div>

			{/* ── Actions ─────────────────────────────────────────────── */}
			<div className="px-5 pt-3 pb-5 space-y-3">
				{/* Copy row */}
				<div className="flex items-center gap-2">
					<CopyBtn text={currentCodes.html} label="HTML" />
					<CopyBtn text={currentCodes.markdown} label="Markdown" />
					<CopyBtn text={profileUrl} label="Link" />
				</div>

				{/* Expandable code */}
				<button
					type="button"
					onClick={() => setShowCode(!showCode)}
					className="flex items-center gap-1 text-[10px] text-text-dim hover:text-text-muted transition-colors"
				>
					<ChevronDown className={cn('h-3 w-3 transition-transform', showCode && 'rotate-180')} />
					{showCode ? 'Hide embed code' : 'Show embed code'}
				</button>

				{showCode && (
					<div className="space-y-1.5">
						<pre className="rounded-md border border-border bg-surface px-3 py-2 text-[9px] font-mono text-text-dim overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
							{currentCodes.html}
						</pre>
						<pre className="rounded-md border border-border bg-surface px-3 py-2 text-[9px] font-mono text-text-dim overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
							{currentCodes.markdown}
						</pre>
					</div>
				)}
			</div>
		</div>
	);
}
