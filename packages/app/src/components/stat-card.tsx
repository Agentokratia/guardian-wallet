interface StatCardProps {
	label: string;
	value: string | number;
	icon?: React.ReactNode;
}

export function StatCard({ label, value, icon }: StatCardProps) {
	return (
		<div className="rounded-xl border border-border bg-surface px-4 py-3">
			<div className="flex items-center gap-1.5">
				{icon && <span className="text-text-dim">{icon}</span>}
				<span className="text-[11px] font-medium uppercase tracking-wider text-text-dim">
					{label}
				</span>
			</div>
			<div className="mt-1.5 text-xl font-bold tabular-nums text-text">{value}</div>
		</div>
	);
}
