import { ActivityFeedItem } from '@/components/activity-feed-item';
import { Mono } from '@/components/ui/mono';
import type { SigningRequest } from '@/lib/types';
import { Link } from 'react-router-dom';

interface ActivityFeedProps {
	entries: SigningRequest[];
	signerNames?: Record<string, string>;
	showSigner?: boolean;
	maxItems?: number;
	viewAllHref?: string;
}

export function ActivityFeed({
	entries,
	signerNames,
	showSigner = true,
	maxItems,
	viewAllHref,
}: ActivityFeedProps) {
	const visible = maxItems ? entries.slice(0, maxItems) : entries;

	if (visible.length === 0) {
		return (
			<div className="rounded-xl border border-border bg-surface px-6 py-8 text-center">
				<Mono size="sm" className="text-text-dim">
					No activity yet
				</Mono>
			</div>
		);
	}

	return (
		<div className="rounded-xl border border-border bg-surface overflow-hidden">
			<div className="divide-y divide-border">
				{visible.map((entry) => (
					<ActivityFeedItem
						key={entry.id}
						entry={entry}
						signerName={signerNames?.[entry.signerId]}
						showSigner={showSigner}
					/>
				))}
			</div>
			{viewAllHref && entries.length > (maxItems ?? 0) && (
				<div className="border-t border-border px-4 py-2.5 text-center">
					<Link
						to={viewAllHref}
						className="text-[13px] font-medium text-text-dim hover:text-accent transition-colors"
					>
						View all activity
					</Link>
				</div>
			)}
		</div>
	);
}
