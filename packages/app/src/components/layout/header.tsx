import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';

interface HeaderProps {
	title: string;
	subtitle?: React.ReactNode;
	backHref?: string;
	backLabel?: string;
	actions?: React.ReactNode;
	className?: string;
}

export function Header({ title, subtitle, backHref, backLabel, actions, className }: HeaderProps) {
	return (
		<div className={cn('mb-6', className)}>
			{backHref && (
				<Link
					to={backHref}
					className="mb-4 inline-block text-[13px] text-text-dim hover:text-text-muted transition-colors"
				>
					&larr; {backLabel ?? 'Back'}
				</Link>
			)}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-[22px] font-bold text-text">{title}</h1>
					{subtitle && <div className="mt-1">{subtitle}</div>}
				</div>
				{actions && <div className="flex items-center gap-2">{actions}</div>}
			</div>
		</div>
	);
}
