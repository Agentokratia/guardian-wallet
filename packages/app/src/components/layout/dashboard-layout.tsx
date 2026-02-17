import { GuardianLogo } from '@/components/guardian-logo';
import { useAuth } from '@/hooks/use-auth';
import { LogOut, Search } from 'lucide-react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './sidebar';

export function DashboardLayout() {
	const { email, address, logout } = useAuth();
	const navigate = useNavigate();
	const { pathname } = useLocation();

	return (
		<div className="flex h-screen w-screen overflow-hidden bg-background">
			<Sidebar />
			<div className="flex flex-1 flex-col overflow-hidden">
				{/* Top bar */}
				<div className="flex items-center justify-end px-4 py-2.5 md:px-8">
					{/* Mobile logo — visible only below md */}
					<div className="flex md:hidden items-center gap-2.5 mr-auto">
						<GuardianLogo width={24} height={24} />
						<span className="text-sm font-bold text-text font-serif">Guardian</span>
					</div>

					{/* Cmd+K hint */}
					<button
						type="button"
						onClick={() =>
							document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
						}
						className="mr-auto hidden md:flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-[12px] text-text-dim hover:text-text-muted hover:border-border-light transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
					>
						<Search className="h-3 w-3" />
						<span>Search...</span>
						<span className="flex items-center gap-0.5">
							<kbd>&#8984;</kbd>
							<kbd>K</kbd>
						</span>
					</button>

					{/* User info */}
					<div className="flex items-center gap-3">
						<div className="text-right">
							{email && <div className="text-[12px] text-text-muted">{email}</div>}
							{address && (
								<div className="text-[11px] font-mono text-text-dim">
									{address.slice(0, 6)}...{address.slice(-4)}
								</div>
							)}
						</div>
						<button
							type="button"
							onClick={async () => {
								await logout();
								navigate('/login');
							}}
							className="flex h-8 w-8 items-center justify-center rounded-md text-text-dim hover:bg-surface-hover hover:text-danger transition-colors"
							aria-label="Sign out"
						>
							<LogOut className="h-3.5 w-3.5" />
						</button>
					</div>
				</div>
				<main className="flex-1 overflow-auto px-4 py-5 md:px-8 md:py-7">
					<div key={pathname} className="animate-page-enter">
						<Outlet />
					</div>
				</main>
			</div>
		</div>
	);
}
