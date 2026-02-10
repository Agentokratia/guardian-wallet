import { AccountListItem } from '@/components/account-list-item';
import { GuardianLogo } from '@/components/guardian-logo';
import { Dot } from '@/components/ui/dot';
import { Mono } from '@/components/ui/mono';
import { useAuth } from '@/hooks/use-auth';
import { useHealth } from '@/hooks/use-health';
import { usePortfolioBalance } from '@/hooks/use-portfolio-balance';
import { useSigners } from '@/hooks/use-signers';
import { cn } from '@/lib/utils';
import { Activity, Lock, Plus, Settings } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';

const MAX_SIDEBAR_SIGNERS = 8;

export function Sidebar() {
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const { logout } = useAuth();
	const { data: signers } = useSigners();
	const { data: health } = useHealth();
	const { chain } = useAccount();

	const signerIds = useMemo(() => signers?.map((s) => s.id) ?? [], [signers]);
	const { totalFormatted, balances, isLoading: balancesLoading } = usePortfolioBalance(signerIds, chain?.id);

	const visibleSigners = signers?.slice(0, MAX_SIDEBAR_SIGNERS) ?? [];
	const hasMore = (signers?.length ?? 0) > MAX_SIDEBAR_SIGNERS;

	return (
		<aside className="hidden md:flex h-screen w-60 flex-shrink-0 flex-col border-r border-border bg-surface">
			{/* Logo */}
			<div className="border-b border-border px-4 py-5">
				<div className="flex items-center gap-2.5">
					<GuardianLogo width={32} height={32} />
					<div>
						<div className="text-sm font-bold text-text font-serif">Guardian</div>
						<Mono size="xs" className="text-text-dim">
							Wallet for AI agents
						</Mono>
					</div>
				</div>
			</div>

			{/* Portfolio summary */}
			<Link
				to="/signers"
				className={cn(
					'block border-b border-border px-4 py-3 transition-colors hover:bg-surface-hover',
					pathname === '/signers' && 'bg-accent-muted/50',
				)}
			>
				<Mono size="xs" className="text-text-dim">
					Total Balance
				</Mono>
				<div className="mt-0.5 text-lg font-bold tabular-nums text-text">
					{balancesLoading ? '...' : totalFormatted}
				</div>
				<Mono size="xs" className="text-text-dim">
					View overview
				</Mono>
			</Link>

			{/* Accounts */}
			<nav className="flex-1 overflow-y-auto px-2 py-3">
				<div className="flex items-center justify-between px-3 py-2">
					<span className="text-[10px] font-bold uppercase tracking-widest text-text-dim">
						Accounts
					</span>
					<Link
						to="/signers/new"
						className="flex h-5 w-5 items-center justify-center rounded text-text-dim hover:bg-surface-hover hover:text-accent transition-colors"
						title="Create account"
					>
						<Plus className="h-3.5 w-3.5" />
					</Link>
				</div>
				{visibleSigners.map((signer) => (
					<AccountListItem
						key={signer.id}
						signer={signer}
						balance={balances[signer.id]}
						isActive={pathname === `/signers/${signer.id}` || pathname.startsWith(`/signers/${signer.id}/`)}
					/>
				))}
				{hasMore && (
					<Link
						to="/signers"
						className="block px-3 py-1.5 text-[11px] text-text-dim hover:text-accent transition-colors"
					>
						View all ({signers?.length})
					</Link>
				)}
			</nav>

			{/* System nav + Vault + Logout */}
			<div className="border-t border-border px-2 py-2 space-y-0.5">
				<Link
					to="/audit"
					className={cn(
						'flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
						pathname.startsWith('/audit')
							? 'bg-accent-muted text-accent'
							: 'text-text-muted hover:bg-surface-hover hover:text-text',
					)}
				>
					<Activity className="h-3.5 w-3.5" />
					Activity
				</Link>
				<Link
					to="/settings"
					className={cn(
						'flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
						pathname.startsWith('/settings')
							? 'bg-accent-muted text-accent'
							: 'text-text-muted hover:bg-surface-hover hover:text-text',
					)}
				>
					<Settings className="h-3.5 w-3.5" />
					Settings
				</Link>
			</div>
			<div className="border-t border-border px-4 py-3 space-y-2.5">
				{/* Security status */}
				<div className="flex items-center gap-2">
					<Dot
						color={health?.vault?.connected ? 'success' : 'danger'}
						className="h-2 w-2"
					/>
					<Mono size="sm">
						{health?.vault?.connected ? 'Vault connected' : 'Vault offline'}
					</Mono>
				</div>
				<div className="flex items-center gap-1.5 text-[10px] text-text-dim/60">
					<Lock className="h-2.5 w-2.5" />
					<span>Keys split across 3 shares</span>
				</div>
				<button
					type="button"
					aria-label="Sign out"
					onClick={async () => {
						await logout();
						navigate('/login');
					}}
					className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-text-dim hover:bg-surface-hover hover:text-danger transition-colors"
				>
					<span className="text-sm">{'\u2190'}</span>
					Sign out
				</button>
			</div>
		</aside>
	);
}
