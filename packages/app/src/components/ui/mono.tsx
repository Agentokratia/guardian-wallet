import { cn } from '@/lib/utils';

interface MonoProps {
	children: React.ReactNode;
	size?: 'xs' | 'sm' | 'base';
	className?: string;
}

const sizeMap = {
	xs: 'text-[10px]',
	sm: 'text-[11px]',
	base: 'text-xs',
} as const;

export function Mono({ children, size = 'base', className }: MonoProps) {
	return (
		<span className={cn('font-mono text-text-muted', sizeMap[size], className)}>{children}</span>
	);
}
