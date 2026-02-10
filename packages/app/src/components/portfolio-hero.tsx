import { Loader2, Lock, Shield } from 'lucide-react';

interface PortfolioHeroProps {
	totalBalance: string;
	accountCount: number;
	isLoading: boolean;
	activeCount?: number;
	policyCount?: number;
	blockedToday?: number;
}

export function PortfolioHero({
	totalBalance,
	accountCount,
	isLoading,
	activeCount,
	policyCount,
	blockedToday,
}: PortfolioHeroProps) {
	return (
		<div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#18181B] to-[#27272A] px-8 py-10">
			{/* Subtle radial glow */}
			<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_70%_20%,rgba(255,255,255,0.04)_0%,transparent_60%)]" />
			<div className="relative">
				<p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-white/40">
					Total Portfolio Balance
				</p>
				<div className="mt-3 text-5xl font-bold tabular-nums tracking-tight text-white">
					{isLoading ? (
						<Loader2 className="h-10 w-10 animate-spin text-white/30" />
					) : (
						totalBalance
					)}
				</div>

				{/* Stats row */}
				<div className="mt-5 flex items-center gap-4 text-[13px] text-white/35">
					<span>
						{accountCount} account{accountCount !== 1 ? 's' : ''}
					</span>
					{activeCount !== undefined && (
						<>
							<span className="text-white/15">|</span>
							<span className="flex items-center gap-1">
								<div className="h-1.5 w-1.5 rounded-full bg-success/70" />
								{activeCount} active
							</span>
						</>
					)}
					{policyCount !== undefined && policyCount > 0 && (
						<>
							<span className="text-white/15">|</span>
							<span className="flex items-center gap-1">
								<Shield className="h-3 w-3" />
								{policyCount} polic{policyCount === 1 ? 'y' : 'ies'}
							</span>
						</>
					)}
					{blockedToday !== undefined && blockedToday > 0 && (
						<>
							<span className="text-white/15">|</span>
							<span className="text-red-400/70">{blockedToday} blocked today</span>
						</>
					)}
				</div>

				{/* Trust signal */}
				<div className="mt-5 flex items-center gap-1.5 text-[11px] text-white/25">
					<Lock className="h-3 w-3" />
					<span>Protected by 2-of-3 threshold cryptography</span>
				</div>
			</div>
		</div>
	);
}
