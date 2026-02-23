import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';

/* -------------------------------------------------------------------------- */
/*  Props                                                                      */
/* -------------------------------------------------------------------------- */

interface ErrorPhaseProps {
	errorMessage: string;
	onRetry: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function ErrorPhase({ errorMessage, onRetry }: ErrorPhaseProps) {
	return (
		<div role="alert" className="space-y-4">
			<Card className="border-danger/30 bg-danger-muted">
				<CardContent className="p-4">
					<div className="flex items-start gap-3">
						<AlertTriangle className="h-5 w-5 text-danger shrink-0 mt-0.5" aria-hidden="true" />
						<div>
							<h2 className="text-sm font-medium text-text">Something went wrong</h2>
							<p className="mt-1 text-xs text-text-muted">{errorMessage}</p>
							<p className="mt-2 text-xs text-text-dim">
								Check your connection and try again. If this keeps happening, check the server logs.
							</p>
						</div>
					</div>
				</CardContent>
			</Card>
			<Button onClick={onRetry} variant="outline" className="w-full">
				Try Again
			</Button>
		</div>
	);
}
