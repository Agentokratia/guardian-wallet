import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Fingerprint, Loader2, ShieldCheck } from 'lucide-react';
import { useCallback, useState } from 'react';

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const PASSKEY_BENEFITS = [
	'Sign transactions from the dashboard',
	'Override the CLI signer when needed',
	'Recover access on a new device',
] as const;

/* -------------------------------------------------------------------------- */
/*  Props                                                                      */
/* -------------------------------------------------------------------------- */

interface EncryptPhaseProps {
	onEncrypt: () => Promise<void>;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function EncryptPhase({ onEncrypt }: EncryptPhaseProps) {
	const [encrypting, setEncrypting] = useState(false);
	const [error, setError] = useState('');

	const handleEncrypt = useCallback(async () => {
		setEncrypting(true);
		setError('');
		try {
			await onEncrypt();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Passkey authentication failed');
			setEncrypting(false);
		}
	}, [onEncrypt]);

	return (
		<Card className="border-border bg-surface">
			<CardContent className="p-6 space-y-5">
				<div className="text-center space-y-3">
					<div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
						{encrypting ? (
							<Loader2
								className="h-6 w-6 animate-spin text-accent motion-reduce:animate-none"
								aria-hidden="true"
							/>
						) : (
							<Fingerprint className="h-6 w-6 text-accent" aria-hidden="true" />
						)}
					</div>

					<div>
						<h2 className="text-[15px] font-semibold text-text">
							{encrypting ? 'Waiting for passkey\u2026' : 'Secure your recovery key'}
						</h2>
						<p className="mt-1.5 text-[12px] text-text-muted leading-relaxed max-w-sm mx-auto">
							{encrypting
								? 'Complete the passkey prompt in your browser to secure your recovery key.'
								: 'Your passkey encrypts a recovery key that lets you sign from the dashboard and recover access if needed. This only takes a second.'}
						</p>
					</div>
				</div>

				{/* What this enables */}
				<div className="rounded-lg bg-surface-hover px-4 py-3 space-y-1.5">
					<p className="text-[11px] font-semibold text-text-muted">This enables:</p>
					<ul className="space-y-1">
						{PASSKEY_BENEFITS.map((item) => (
							<li key={item} className="flex items-start gap-2 text-[11px] text-text-dim">
								<ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
								{item}
							</li>
						))}
					</ul>
				</div>

				{error && (
					<div role="alert" className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
						<p className="text-[12px] text-warning leading-relaxed">{error}</p>
					</div>
				)}

				<div className="space-y-2">
					<Button onClick={handleEncrypt} disabled={encrypting} className="w-full" size="lg">
						{encrypting ? (
							<>
								<Loader2
									className="h-4 w-4 animate-spin motion-reduce:animate-none"
									aria-hidden="true"
								/>
								Encrypting{'\u2026'}
							</>
						) : error ? (
							<>
								<Fingerprint className="h-4 w-4" aria-hidden="true" />
								Try Again
							</>
						) : (
							<>
								<Fingerprint className="h-4 w-4" aria-hidden="true" />
								Encrypt with Passkey
							</>
						)}
					</Button>
					<p className="text-center text-[10px] text-text-dim">
						Required to secure your recovery key. It only takes a second.
					</p>
				</div>
			</CardContent>
		</Card>
	);
}
