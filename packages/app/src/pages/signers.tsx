import { ActivityFeed } from '@/components/activity-feed';
import { PortfolioHero } from '@/components/portfolio-hero';
import { SignerCard } from '@/components/signer-card';
import { Button } from '@/components/ui/button';
import { useAuditLog } from '@/hooks/use-audit-log';
import { usePortfolioBalance } from '@/hooks/use-portfolio-balance';
import { useSignerPolicyCounts } from '@/hooks/use-signer-policy-counts';
import { useSigners } from '@/hooks/use-signers';
import { formatTimestamp } from '@/lib/formatters';
import { Lock, Plus, Shield } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from 'wagmi';

function SignerCardSkeleton() {
	return (
		<div className="rounded-lg border border-border bg-surface p-5 animate-pulse">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<div className="h-9 w-9 rounded-xl bg-surface-hover" />
					<div className="space-y-2">
						<div className="h-4 w-24 rounded bg-surface-hover" />
						<div className="h-3 w-32 rounded bg-surface-hover" />
					</div>
				</div>
				<div className="h-3 w-12 rounded bg-surface-hover" />
			</div>
			<div className="mt-4 h-7 w-24 rounded bg-surface-hover" />
			<div className="mt-3 flex items-center justify-between border-t border-border pt-3">
				<div className="h-3 w-20 rounded bg-surface-hover" />
			</div>
		</div>
	);
}

export function SignersPage() {
	const { data: signers, isLoading: signersLoading } = useSigners();
	const { data: recentActivity, isLoading: activityLoading } = useAuditLog({
		limit: 20,
	});
	const { chain } = useAccount();
	const signerIds = useMemo(() => signers?.map((s) => s.id) ?? [], [signers]);
	const { data: policyCounts } = useSignerPolicyCounts(signerIds);
	const { totalFormatted, balances, isLoading: balancesLoading } = usePortfolioBalance(signerIds, chain?.id);

	const activeCount = signers?.filter((s) => s.status === 'active').length ?? 0;
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
			(a) => a.status === 'blocked' && new Date(a.createdAt) >= todayStart,
		).length;
	}, [recentActivity]);

	const signerNames =
		signers?.reduce(
			(acc, s) => {
				acc[s.id] = s.name;
				return acc;
			},
			{} as Record<string, string>,
		) ?? {};

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

	return (
		<div className="space-y-8">
			{/* Portfolio Hero — dark gradient with inline stats */}
			<PortfolioHero
				totalBalance={totalFormatted}
				accountCount={totalCount}
				isLoading={balancesLoading && signersLoading}
				activeCount={activeCount}
				policyCount={totalPolicies}
				blockedToday={blockedToday}
			/>

			{/* Accounts section */}
			<div>
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-[15px] font-semibold text-text">Accounts</h2>
					<Button size="sm" asChild>
						<Link to="/signers/new">
							<Plus className="h-4 w-4" />
							New Account
						</Link>
					</Button>
				</div>

				{signersLoading ? (
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
						{Array.from({ length: 3 }, (_, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list, never reorders
							<SignerCardSkeleton key={`skeleton-${i}`} />
						))}
					</div>
				) : signers && signers.length > 0 ? (
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
						{signers.map((signer) => (
							<SignerCard
								key={signer.id}
								signer={signer}
								policyCount={policyCounts?.[signer.id] ?? 0}
								balance={balances[signer.id]}
								lastAction={lastActionBySigner[signer.id]}
							/>
						))}
					</div>
				) : (
					<div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface px-8 py-16 text-center">
						<div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/[0.06] text-text-muted">
							<Shield className="h-7 w-7" />
						</div>
						<h3 className="mt-5 text-base font-semibold text-text">Create Your First Account</h3>
						<p className="mt-1.5 max-w-sm text-sm text-text-muted">
							Each account is protected by threshold cryptography. The private key is split into 3 shares — no single device ever holds the full key.
						</p>
						<Button asChild className="mt-5">
							<Link to="/signers/new">
								<Plus className="h-4 w-4" />
								Create Account
							</Link>
						</Button>
						<div className="mt-4 flex items-center gap-1.5 text-[11px] text-text-dim">
							<Lock className="h-3 w-3" />
							<span>2-of-3 threshold ECDSA</span>
						</div>
					</div>
				)}
			</div>

			{/* Recent Activity */}
			{(recentActivity?.length ?? 0) > 0 && (
				<div>
					<div className="mb-3 flex items-center justify-between">
						<h2 className="text-[15px] font-semibold text-text">Recent Activity</h2>
						<Link
							to="/audit"
							className="text-xs text-text-muted hover:text-accent transition-colors"
						>
							View all
						</Link>
					</div>
					{activityLoading ? (
						<div className="rounded-xl border border-border bg-surface p-8 text-center animate-pulse">
							<div className="h-4 w-32 mx-auto rounded bg-surface-hover" />
						</div>
					) : (
						<ActivityFeed
							entries={recentActivity ?? []}
							signerNames={signerNames}
							showSigner
							maxItems={10}
							viewAllHref="/audit"
						/>
					)}
				</div>
			)}
		</div>
	);
}
