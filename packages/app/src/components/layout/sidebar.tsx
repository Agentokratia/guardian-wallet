import { AccountListItem } from '@/components/account-list-item';
import { GuardianLogo } from '@/components/guardian-logo';
import { Dot } from '@/components/ui/dot';
import { Mono } from '@/components/ui/mono';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/hooks/use-auth';
import { useHealth } from '@/hooks/use-health';
import { useSigners } from '@/hooks/use-signers';
import { cn } from '@/lib/utils';
import { Activity, ArrowUpRight, Lock, Plus, Settings } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const MAX_SIDEBAR_SIGNERS = 8;

export function Sidebar() {
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const { logout } = useAuth();
	const { data: signers } = useSigners();
	const { data: health } = useHealth();

	const visibleSigners = signers?.slice(0, MAX_SIDEBAR_SIGNERS) ?? [];
	const hasMore = (signers?.length ?? 0) > MAX_SIDEBAR_SIGNERS;

	return (
		<aside className="hidden md:flex h-screen w-60 flex-shrink-0 flex-col border-r border-border bg-white">
			{/* Logo */}
			<div className="border-b border-border/60 px-4 py-5">
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

			{/* Portfolio link */}
			<Link
				to="/signers"
				className={cn(
					'group flex items-center justify-between border-b border-border/60 px-4 py-3 transition-colors hover:bg-surface-hover/60',
					pathname === '/signers' && 'bg-surface-hover/50',
				)}
			>
				<div>
					<span className="text-[13px] font-semibold text-text">Portfolio</span>
					<Mono size="xs" className="text-text-dim mt-0.5 block">
						{signers?.length ?? 0} account{(signers?.length ?? 0) !== 1 ? 's' : ''}
					</Mono>
				</div>
				<ArrowUpRight className="h-3.5 w-3.5 text-text-dim opacity-0 group-hover:opacity-100 transition-opacity" />
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
			<div className="border-t border-border/60 px-2 py-2 space-y-0.5">
				<Link
					to="/audit"
					className={cn(
						'flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
						pathname.startsWith('/audit')
							? 'bg-accent-muted text-accent'
							: 'text-text-muted hover:bg-surface-hover/60 hover:text-text',
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
							: 'text-text-muted hover:bg-surface-hover/60 hover:text-text',
					)}
				>
					<Settings className="h-3.5 w-3.5" />
					Settings
				</Link>
			</div>
			<div className="border-t border-border/60 px-4 py-3 space-y-2.5">
				{/* Security status */}
				<Tooltip>
					<TooltipTrigger asChild>
						<div className="flex items-center gap-2 rounded-lg bg-surface-hover/40 px-2.5 py-1.5 cursor-default">
							<Dot
								color={health?.vault?.connected ? 'success' : 'danger'}
								pulse={health?.vault?.connected}
								className="h-2 w-2"
							/>
							<Mono size="sm" className={health?.vault?.connected ? 'text-text-muted' : 'text-danger/80'}>
								{health?.vault?.connected ? 'Vault connected' : 'Vault offline'}
							</Mono>
						</div>
					</TooltipTrigger>
					<TooltipContent side="right">
						{health?.vault?.connected
							? 'HashiCorp Vault is storing encrypted key shares securely.'
							: 'Vault is unreachable. Signing operations will fail.'}
					</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<div className="flex items-center gap-1.5 text-[10px] text-text-dim/60 cursor-default">
							<Lock className="h-2.5 w-2.5" />
							<span>Keys split across 3 shares</span>
						</div>
					</TooltipTrigger>
					<TooltipContent side="right">
						Every private key is split into 3 shares via threshold cryptography. Any 2 can sign — the full key never exists.
					</TooltipContent>
				</Tooltip>
				<button
					type="button"
					aria-label="Sign out"
					onClick={async () => {
						await logout();
						navigate('/login');
					}}
					className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-text-dim hover:bg-surface-hover/60 hover:text-danger transition-colors"
				>
					<span className="text-sm">{'\u2190'}</span>
					Sign out
				</button>
			</div>
		</aside>
	);
}
