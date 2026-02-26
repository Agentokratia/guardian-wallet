import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, Clock } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

/* -------------------------------------------------------------------------- */
/*  Props                                                                      */
/* -------------------------------------------------------------------------- */

interface ErrorPhaseProps {
	errorMessage: string;
	errorStatus?: number | null;
	onRetry: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

const POOL_COUNTDOWN_SECONDS = 60;

export function ErrorPhase({ errorMessage, errorStatus, onRetry }: ErrorPhaseProps) {
	const isPoolEmpty = errorStatus === 503;

	const [countdown, setCountdown] = useState(isPoolEmpty ? POOL_COUNTDOWN_SECONDS : 0);

	useEffect(() => {
		if (!isPoolEmpty || countdown <= 0) return;
		const timer = setInterval(() => setCountdown((c) => c - 1), 1_000);
		return () => clearInterval(timer);
	}, [isPoolEmpty, countdown]);

	const handleRetry = useCallback(() => {
		setCountdown(POOL_COUNTDOWN_SECONDS);
		onRetry();
	}, [onRetry]);

	if (isPoolEmpty) {
		return (
			<output className="space-y-4">
				<Card className="border-warning/30 bg-warning-muted">
					<CardContent className="p-4">
						<div className="flex items-start gap-3">
							<Clock className="h-5 w-5 text-warning shrink-0 mt-0.5" aria-hidden="true" />
							<div>
								<h2 className="text-sm font-medium text-text">Almost ready</h2>
								<p className="mt-1 text-xs text-text-muted">
									Your account can't be created just yet. The system is setting up — this usually
									resolves on its own within a minute.
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
				<Button onClick={handleRetry} variant="outline" className="w-full" disabled={countdown > 0}>
					{countdown > 0 ? `Try again in ${countdown}s` : 'Try Again'}
				</Button>
			</output>
		);
	}

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
