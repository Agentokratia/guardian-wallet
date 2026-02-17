import { ArrowDownLeft, ArrowUpRight, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';

interface QuickActionsProps {
	signerId: string;
	network?: string | null;
	onReceive: () => void;
}

export function QuickActions({ signerId, network, onReceive }: QuickActionsProps) {
	const sendPath = network
		? `/signers/${signerId}/sign?network=${network}`
		: `/signers/${signerId}/sign`;

	return (
		<div className="flex items-center justify-center gap-8">
			{/* Send — primary */}
			<Link to={sendPath} className="flex flex-col items-center gap-2 group">
				<div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-[#18181B] shadow-sm transition-all group-hover:scale-110 group-active:scale-95">
					<ArrowUpRight className="h-5 w-5" strokeWidth={2.5} />
				</div>
				<span className="text-[11px] font-medium text-white/50 group-hover:text-white/80 transition-colors">
					Send
				</span>
			</Link>

			{/* Receive — secondary */}
			<button type="button" onClick={onReceive} className="flex flex-col items-center gap-2 group">
				<div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.12] text-white transition-all group-hover:scale-110 group-hover:bg-white/[0.18] group-active:scale-95">
					<ArrowDownLeft className="h-5 w-5" strokeWidth={2.5} />
				</div>
				<span className="text-[11px] font-medium text-white/50 group-hover:text-white/80 transition-colors">
					Receive
				</span>
			</button>

			{/* Settings — tertiary */}
			<Link to={`/signers/${signerId}/settings`} className="flex flex-col items-center gap-2 group">
				<div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.08] text-white/60 transition-all group-hover:scale-110 group-hover:bg-white/[0.14] group-active:scale-95">
					<Settings className="h-5 w-5" strokeWidth={2} />
				</div>
				<span className="text-[11px] font-medium text-white/50 group-hover:text-white/80 transition-colors">
					Settings
				</span>
			</Link>
		</div>
	);
}
