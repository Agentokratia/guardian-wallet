import { cn } from '@/lib/utils';
import { ChevronDown, Filter } from 'lucide-react';
import { useState } from 'react';

interface FilterBarProps {
	children: React.ReactNode;
	activeFilterCount: number;
}

export function FilterBar({ children, activeFilterCount }: FilterBarProps) {
	const [expanded, setExpanded] = useState(false);

	return (
		<div className="mb-4">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-text-muted hover:bg-surface-hover transition-colors"
			>
				<Filter className="h-3.5 w-3.5" />
				Filters
				{activeFilterCount > 0 && (
					<span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent-muted px-1.5 text-[11px] font-semibold text-accent">
						{activeFilterCount}
					</span>
				)}
				<ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
			</button>
			{expanded && <div className="mt-3 flex flex-wrap items-center gap-3">{children}</div>}
		</div>
	);
}
