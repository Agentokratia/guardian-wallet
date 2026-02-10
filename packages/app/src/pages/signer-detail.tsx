import { ActivityFeed } from '@/components/activity-feed';
import { AddTokenDialog } from '@/components/add-token-dialog';
import { QuickActions } from '@/components/quick-actions';
import { ReceiveDialog } from '@/components/receive-dialog';
import { StatCard } from '@/components/stat-card';
import { TokenRow } from '@/components/token-row';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { useAuditLog } from '@/hooks/use-audit-log';
import { useSigner } from '@/hooks/use-signer';
import { useTokenBalances } from '@/hooks/use-token-balances';
import { useRemoveToken } from '@/hooks/use-tokens';
import { useToast } from '@/hooks/use-toast';
import { formatTokenBalance, formatWei } from '@/lib/formatters';
import { getTypeIcon, statusConfig } from '@/lib/signer-constants';
import {
	ArrowLeft,
	Check,
	Copy,
	Loader2,
	Lock,
	Plus,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';

/* ========================================================================== */
/*  Sub-components                                                             */
/* ========================================================================== */

function DetailSkeleton() {
	return (
		<div className="animate-pulse space-y-6">
			<div className="h-[280px] rounded-2xl bg-[#27272A]" />
			<div className="space-y-3">
				<div className="h-5 w-20 rounded bg-surface-hover" />
				<div className="h-[140px] rounded-xl bg-surface-hover" />
			</div>
		</div>
	);
}

function CopyButton({ text, className }: { text: string; className?: string }) {
	const [copied, setCopied] = useState(false);
	const handleCopy = async () => {
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};
	return (
		<button
			type="button"
			onClick={handleCopy}
			className={`shrink-0 transition-colors ${className ?? 'text-text-dim hover:text-text'}`}
			aria-label="Copy"
		>
			{copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
		</button>
	);
}

/* ========================================================================== */
/*  Main page                                                                  */
/* ========================================================================== */

export function SignerDetailPage() {
	const { id } = useParams<{ id: string }>();
	const signerId = id ?? '';
	const { toast } = useToast();
	const { chain } = useAccount();

	const { data: signer, isLoading: signerLoading } = useSigner(signerId);
	const { data: tokenData, isLoading: tokensLoading } = useTokenBalances(signerId, chain?.id);

	const todayStart = useMemo(() => {
		const d = new Date();
		d.setHours(0, 0, 0, 0);
		return d.toISOString();
	}, []);

	const { data: activity, isLoading: activityLoading } = useAuditLog({
		signerId,
		from: todayStart,
		limit: 200,
	});

	const [addTokenOpen, setAddTokenOpen] = useState(false);
	const [receiveOpen, setReceiveOpen] = useState(false);

	const removeToken = useRemoveToken();

	const todaysSpend = useMemo(() => {
		const spend = (activity ?? [])
			.filter(
				(a) =>
					(a.status === 'approved' || a.status === 'broadcast' || a.status === 'completed') &&
					a.valueWei,
			)
			.reduce((sum, a) => sum + BigInt(a.valueWei ?? '0'), 0n);
		return spend > 0n ? formatWei(spend.toString()) : '0 ETH';
	}, [activity]);

	const requestsToday = activity?.length ?? 0;

	// Native balance from token data for the hero
	const nativeToken = tokenData?.tokens.find((t) => t.isNative);
	const nativeBalanceFormatted = nativeToken
		? `${formatTokenBalance(nativeToken.balance, nativeToken.decimals)} ${nativeToken.symbol}`
		: '---';

	const handleRemoveToken = (tokenId: string, symbol: string) => {
		removeToken.mutate(
			{ signerId, tokenId },
			{
				onSuccess: () => toast({ title: 'Token removed', description: `${symbol} removed.` }),
				onError: () =>
					toast({ title: 'Error', description: 'Failed to remove token.', variant: 'destructive' }),
			},
		);
	};

	/* Loading */
	if (signerLoading) {
		return (
			<>
				<Link
					to="/signers"
					className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-text-dim hover:text-text-muted transition-colors"
				>
					<ArrowLeft className="h-3.5 w-3.5" />
					Accounts
				</Link>
				<DetailSkeleton />
			</>
		);
	}

	/* Not found */
	if (!signer) {
		return (
			<>
				<Link
					to="/signers"
					className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-text-dim hover:text-text-muted transition-colors"
				>
					<ArrowLeft className="h-3.5 w-3.5" />
					Accounts
				</Link>
				<div className="rounded-xl border border-border bg-surface px-6 py-16 text-center">
					<p className="text-sm text-text-muted">Account not found.</p>
				</div>
			</>
		);
	}

	const status = statusConfig[signer.status];
	const icon = getTypeIcon(signer.type, 'h-5 w-5');

	return (
		<div className="space-y-8">
			{/* Breadcrumb */}
			<Link
				to="/signers"
				className="inline-flex items-center gap-1.5 text-[13px] text-text-dim hover:text-text-muted transition-colors"
			>
				<ArrowLeft className="h-3.5 w-3.5" />
				Accounts
			</Link>

			{/* ================================================================ */}
			{/*  HERO — Dark gradient card                                       */}
			{/* ================================================================ */}
			<div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#18181B] to-[#27272A] px-8 py-8">
				{/* Subtle radial glow */}
				<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_70%_20%,rgba(255,255,255,0.04)_0%,transparent_60%)]" />
				<div className="relative">
					{/* Identity row */}
					<div className="flex items-center gap-3.5">
						<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.1] text-white">
							{icon}
						</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2.5">
								<h1 className="text-lg font-bold text-white truncate">
									{signer.name}
								</h1>
								<Pill color={status.pill}>{status.label}</Pill>
							</div>
							<div className="mt-1 flex items-center gap-2">
								<code className="text-[12px] text-white/35 font-mono">
									{signer.ethAddress}
								</code>
								<CopyButton text={signer.ethAddress} className="text-white/30 hover:text-white/60" />
								<span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.08] text-white/40 font-medium">
									{signer.chain}
								</span>
							</div>
						</div>
					</div>

					{/* Balance — centered, large */}
					<div className="mt-10 text-center">
						<p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-white/35">
							Balance
						</p>
						<div className="mt-2 text-4xl font-bold tabular-nums tracking-tight text-white">
							{tokensLoading ? (
								<Loader2 className="h-8 w-8 animate-spin text-white/30 mx-auto" />
							) : (
								nativeBalanceFormatted
							)}
						</div>
					</div>

					{/* Circular quick actions */}
					<div className="mt-8">
						<QuickActions
							signerId={signerId}
							onReceive={() => setReceiveOpen(true)}
						/>
					</div>

					{/* Trust signal */}
					<div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-white/20">
						<Lock className="h-3 w-3" />
						<span>Key split across 3 shares. Never reconstructed.</span>
					</div>
				</div>
			</div>

			{/* ================================================================ */}
			{/*  TOKENS                                                          */}
			{/* ================================================================ */}
			<div>
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-[15px] font-semibold text-text">Tokens</h2>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setAddTokenOpen(true)}
					>
						<Plus className="h-3.5 w-3.5" />
						Add Token
					</Button>
				</div>
				{tokensLoading ? (
					<div className="rounded-xl border border-border bg-surface animate-pulse">
						{Array.from({ length: 3 }, (_, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
							<div key={`ts-${i}`} className="flex items-center gap-3.5 px-4 py-3.5 border-b border-border last:border-0">
								<div className="h-10 w-10 rounded-full bg-surface-hover" />
								<div className="flex-1 space-y-1.5">
									<div className="h-4 w-16 rounded bg-surface-hover" />
									<div className="h-3 w-24 rounded bg-surface-hover" />
								</div>
								<div className="h-4 w-20 rounded bg-surface-hover" />
							</div>
						))}
					</div>
				) : tokenData && tokenData.tokens.length > 0 ? (
					<div className="rounded-xl border border-border bg-surface overflow-hidden divide-y divide-border">
						{tokenData.tokens.map((token) => (
							<TokenRow
								key={token.id}
								token={token}
								signerId={signerId}
								onRemove={
									token.source === 'custom'
										? () => handleRemoveToken(token.id, token.symbol)
										: undefined
								}
							/>
						))}
					</div>
				) : (
					<div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
						<p className="text-sm text-text-dim">
							No tokens tracked on this network
						</p>
					</div>
				)}
			</div>

			{/* ================================================================ */}
			{/*  RECENT ACTIVITY                                                 */}
			{/* ================================================================ */}
			<div>
				<h2 className="mb-3 text-[15px] font-semibold text-text">Recent Activity</h2>
				<div className="flex items-center gap-3 mb-4">
					<StatCard label="Today's Spend" value={activityLoading ? '...' : todaysSpend} />
					<StatCard label="Requests Today" value={requestsToday} />
				</div>
				{activityLoading ? (
					<div className="rounded-xl border border-border bg-surface p-5 space-y-3 animate-pulse">
						{Array.from({ length: 3 }, (_, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
							<div key={`a-${i}`} className="h-10 rounded-lg bg-surface-hover" />
						))}
					</div>
				) : (
					<ActivityFeed
						entries={activity ?? []}
						showSigner={false}
						maxItems={10}
						viewAllHref={`/audit?signerId=${signerId}`}
					/>
				)}
			</div>

			{/* ================================================================ */}
			{/*  DIALOGS                                                         */}
			{/* ================================================================ */}
			{chain?.id && (
				<AddTokenDialog
					open={addTokenOpen}
					onOpenChange={setAddTokenOpen}
					signerId={signerId}
					chainId={chain.id}
				/>
			)}

			<ReceiveDialog
				open={receiveOpen}
				onOpenChange={setReceiveOpen}
				address={signer.ethAddress}
				accountName={signer.name}
			/>
		</div>
	);
}
