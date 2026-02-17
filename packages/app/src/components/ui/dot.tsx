import { cn } from '@/lib/utils';

const colorMap = {
	success: 'bg-success shadow-[0_0_6px_theme(colors.success.DEFAULT)]',
	warning: 'bg-warning shadow-[0_0_6px_theme(colors.warning.DEFAULT)]',
	danger: 'bg-danger shadow-[0_0_6px_theme(colors.danger.DEFAULT)]',
	accent: 'bg-accent shadow-[0_0_6px_theme(colors.accent.DEFAULT)]',
} as const;

interface DotProps {
	color?: keyof typeof colorMap;
	pulse?: boolean;
	className?: string;
}

export function Dot({ color = 'success', pulse, className }: DotProps) {
	return (
		<span
			className={cn(
				'inline-block h-1.5 w-1.5 rounded-full',
				colorMap[color],
				pulse && 'animate-dot-pulse',
				className,
			)}
		/>
	);
}
