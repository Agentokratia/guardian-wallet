interface GuardianLogoProps {
	className?: string;
	width?: number;
	height?: number;
}

/**
 * Agentokratia "Crown Dots" mark — an A with three dots forming a crown.
 * Selected logo variant per agentokratia-brand-guidelines.html.
 */
export function GuardianLogo({ className, width = 72, height = 72 }: GuardianLogoProps) {
	return (
		<svg
			width={width}
			height={height}
			viewBox="0 0 48 48"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className={className}
		>
			{/* A letterform */}
			<path d="M24 6L9 42H17L19 36H29L31 42H39L24 6Z" fill="currentColor" />
			<path d="M24 16L21 28H27L24 16Z" fill="var(--bg, #FAFAF8)" />
			{/* Crown dots */}
			<circle cx="13" cy="10" r="2" fill="currentColor" />
			<circle cx="24" cy="5" r="2" fill="currentColor" />
			<circle cx="35" cy="10" r="2" fill="currentColor" />
		</svg>
	);
}
