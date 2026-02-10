import { cn } from '@/lib/utils';

const colorMap = {
	default: 'bg-accent-muted text-accent',
	success: 'bg-success-muted text-success',
	warning: 'bg-warning-muted text-warning',
	danger: 'bg-danger-muted text-danger',
} as const;

interface PillProps {
	children: React.ReactNode;
	color?: keyof typeof colorMap;
	className?: string;
}

export function Pill({ children, color = 'default', className }: PillProps) {
	return (
		<span
			className={cn(
				'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold font-mono tracking-wide',
				colorMap[color],
				className,
			)}
		>
			{children}
		</span>
	);
}
