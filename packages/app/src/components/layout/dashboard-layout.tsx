import { ConnectButton } from '@rainbow-me/rainbowkit';
import { GuardianLogo } from '@/components/guardian-logo';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './sidebar';

export function DashboardLayout() {
	return (
		<div className="flex h-screen w-screen overflow-hidden bg-background">
			<Sidebar />
			<div className="flex flex-1 flex-col overflow-hidden">
				{/* Top bar with wallet connect */}
				<div className="flex items-center justify-end px-4 py-2.5 md:px-8">
					{/* Mobile logo — visible only below md */}
					<div className="flex md:hidden items-center gap-2.5 mr-auto">
						<GuardianLogo width={24} height={24} />
						<span className="text-sm font-bold text-text font-serif">Guardian</span>
					</div>
					{/* Wallet connect — always visible top-right */}
					<ConnectButton
						accountStatus="address"
						chainStatus="icon"
						showBalance={false}
					/>
				</div>
				<main className="flex-1 overflow-auto px-4 py-5 md:px-8 md:py-7">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
