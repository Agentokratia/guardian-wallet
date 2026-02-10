import { GuardianLogo } from '@/components/guardian-logo';
import { Button } from '@/components/ui/button';
import { Mono } from '@/components/ui/mono';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

export function SetupPage() {
	return (
		<div className="flex h-screen w-screen items-center justify-center bg-background">
			<div className="flex w-full max-w-md flex-col items-center px-6 text-center">
				{/* Crown Dots logo */}
				<GuardianLogo className="drop-shadow-lg" />

				{/* Title */}
				<h1 className="mt-6 text-xl font-bold text-text font-serif">Welcome to Guardian</h1>

				{/* Description */}
				<p className="mt-3 text-sm leading-relaxed text-text-muted">
					Guarded accounts for humans and AI agents. Each account gets its own address, protected so no single device ever holds the full key.
				</p>

				{/* CTA */}
				<Button asChild size="lg" className="mt-8 w-full max-w-xs">
					<Link to="/signers/new">
						Create Your First Account
						<ArrowRight className="h-4 w-4" />
					</Link>
				</Button>

				{/* Docs link */}
				<Link
					to="/settings"
					className="mt-4 inline-flex items-center gap-1.5 text-sm text-text-dim transition-colors hover:text-accent"
				>
					<Mono size="sm">Read the documentation</Mono>
					<ExternalLink className="h-3.5 w-3.5" />
				</Link>
			</div>
		</div>
	);
}
