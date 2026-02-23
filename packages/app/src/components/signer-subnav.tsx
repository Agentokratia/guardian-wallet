import { Pill } from '@/components/ui/pill';
import { useSigner } from '@/hooks/use-signer';
import { getExplorerAddressUrl } from '@/lib/chains';
import { getTypeIcon, statusConfig } from '@/lib/signer-constants';
import { cn } from '@/lib/utils';
import { ArrowLeft, Check, Copy, ExternalLink, Settings } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';

export function SignerSubnav({ children }: { children: ReactNode }) {
	const { id } = useParams<{ id: string }>();
	const signerId = id ?? '';
	const { data: signer, isLoading } = useSigner(signerId);
	const location = useLocation();
	const [copied, setCopied] = useState(false);

	// Sub-pages (guardrails, settings, sign) → back goes to overview
	// Overview (/signers/:id) → back goes to list
	const isSubPage = /\/signers\/[^/]+\/.+/.test(location.pathname);
	const backTo = isSubPage ? `/signers/${signerId}` : '/signers';

	if (isLoading) {
		return (
			<div className="space-y-4">
				<div className="flex items-center gap-2.5">
					<Link to={backTo} className="text-text-dim hover:text-text-muted transition-colors">
						<ArrowLeft className="h-4 w-4" />
					</Link>
					<div className="h-5 w-36 rounded bg-surface-hover animate-pulse" />
				</div>
				<div className="h-[300px] rounded-xl bg-surface-hover animate-pulse" />
			</div>
		);
	}

	if (!signer) {
		return (
			<div className="space-y-4">
				<Link
					to={backTo}
					className="inline-flex items-center gap-1.5 text-[13px] text-text-dim hover:text-text-muted transition-colors"
				>
					<ArrowLeft className="h-3.5 w-3.5" />
					Accounts
				</Link>
				<div className="rounded-xl border border-border bg-surface px-6 py-16 text-center">
					<p className="text-sm text-text-muted">Account not found.</p>
				</div>
			</div>
		);
	}

	const status = statusConfig[signer.status];
	const icon = getTypeIcon(signer.type, 'h-3.5 w-3.5');

	return (
		<div className="space-y-5">
			{/* Single-line header — no tabs */}
			<div className="flex items-center gap-2.5">
				<Link
					to={backTo}
					className="shrink-0 text-text-dim hover:text-text-muted transition-colors"
				>
					<ArrowLeft className="h-4 w-4" />
				</Link>
				<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/[0.06] text-text-muted">
					{icon}
				</div>
				<h1 className="text-[14px] font-bold text-text truncate">{signer.name}</h1>
				<Pill color={status.pill}>{status.label}</Pill>
				<div className="hidden sm:flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1">
					<code className="text-[12px] text-text-muted font-mono">
						{signer.ethAddress.slice(0, 6)}...{signer.ethAddress.slice(-4)}
					</code>
					<button
						type="button"
						onClick={async () => {
							await navigator.clipboard.writeText(signer.ethAddress);
							setCopied(true);
							setTimeout(() => setCopied(false), 2000);
						}}
						className="text-text-dim hover:text-text transition-colors"
						aria-label="Copy address"
					>
						{copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
					</button>
					{(() => {
						const explorerUrl = getExplorerAddressUrl(1, signer.ethAddress);
						return explorerUrl ? (
							<a
								href={explorerUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="text-text-dim hover:text-accent transition-colors"
								aria-label="View on explorer"
							>
								<ExternalLink className="h-3 w-3" />
							</a>
						) : null;
					})()}
				</div>
				<div className="flex-1" />
				<Link
					to={`/signers/${signerId}/settings`}
					className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:text-text-muted hover:bg-surface-hover transition-colors"
					title="Settings"
				>
					<Settings className="h-3.5 w-3.5" />
				</Link>
			</div>

			{children}
		</div>
	);
}
