import { useAddContract } from '@/hooks/use-contract-mutations';
import type { KnownContract } from '@/hooks/use-known-contracts';
import { useKnownContracts } from '@/hooks/use-known-contracts';
import { getExplorerAddressUrl } from '@/lib/chains';
import { cn } from '@/lib/utils';
import { Check, ExternalLink, Loader2, Plus, Search } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Types + constants                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface QuickAddProps {
	chainId: number | undefined;
	selectedAddresses: string[];
	onAdd: (address: string) => void;
	onRemove?: (address: string) => void;
	className?: string;
}

const PROTOCOL_PRIORITY: Record<string, number> = {
	Uniswap: 1,
	Aave: 2,
	'1inch': 3,
	Curve: 4,
	Lido: 5,
	Compound: 6,
	GMX: 7,
	Aerodrome: 8,
	Velodrome: 9,
	Polymarket: 10,
	'0x': 11,
	Paraswap: 12,
	Odos: 13,
	Balancer: 14,
	SushiSwap: 15,
};

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  QuickAdd                                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function QuickAdd({
	chainId,
	selectedAddresses,
	onAdd,
	onRemove,
	className,
}: QuickAddProps) {
	const { data: contracts, isLoading } = useKnownContracts(chainId);
	const [search, setSearch] = useState('');
	const [showCustom, setShowCustom] = useState(false);

	const selectedSet = useMemo(
		() => new Set(selectedAddresses.map((a) => a.toLowerCase())),
		[selectedAddresses],
	);

	const groups = useMemo(() => {
		if (!contracts) return [];
		const map = new Map<string, KnownContract[]>();
		for (const c of contracts) {
			const list = map.get(c.protocol) ?? [];
			list.push(c);
			map.set(c.protocol, list);
		}
		return [...map.entries()]
			.map(([protocol, items]) => ({ protocol, contracts: items }))
			.sort(
				(a, b) => (PROTOCOL_PRIORITY[a.protocol] ?? 50) - (PROTOCOL_PRIORITY[b.protocol] ?? 50),
			);
	}, [contracts]);

	const filtered = useMemo(() => {
		if (!search.trim()) return groups;
		const q = search.toLowerCase();
		return groups
			.map((g) => ({
				...g,
				contracts: g.contracts.filter(
					(c) =>
						c.protocol.toLowerCase().includes(q) ||
						c.name.toLowerCase().includes(q) ||
						c.address.toLowerCase().includes(q),
				),
			}))
			.filter((g) => g.contracts.length > 0);
	}, [groups, search]);

	const hasContracts = contracts && contracts.length > 0;
	if (isLoading && !hasContracts) return null;

	return (
		<div className={cn('space-y-1.5', className)}>
			{/* Header row */}
			<div className="flex items-center gap-2">
				<span className="text-[10px] font-medium uppercase tracking-wider text-text-dim shrink-0">
					Browse
				</span>
				{hasContracts && (
					<div className="relative flex-1 max-w-[180px]">
						<Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-text-dim pointer-events-none" />
						<input
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Filter..."
							className="w-full rounded border border-border bg-background pl-5 pr-2 py-0.5 text-[10px] text-text placeholder:text-text-dim/40 focus:border-accent/40 focus:outline-none"
						/>
					</div>
				)}
			</div>

			{/* Grouped chips */}
			{filtered.length > 0 && (
				<div className="space-y-1">
					{filtered.map(({ protocol, contracts: items }) => (
						<div key={protocol} className="flex flex-wrap items-center gap-1">
							{/* Protocol label */}
							<span
								className="text-[9px] font-semibold uppercase tracking-wide text-text-dim w-16 shrink-0 truncate"
								title={protocol}
							>
								{protocol}
							</span>

							{/* Contract chips */}
							{items.map((c) => {
								const isSelected = selectedSet.has(c.address.toLowerCase());
								const explorerUrl = chainId ? getExplorerAddressUrl(chainId, c.address) : null;
								return (
									<span key={c.id} className="inline-flex items-center gap-0.5">
										<button
											type="button"
											onClick={() =>
												isSelected
													? onRemove?.(c.address.toLowerCase())
													: onAdd(c.address.toLowerCase())
											}
											title={isSelected ? `Remove ${c.name}` : c.address}
											className={cn(
												'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition-colors',
												isSelected
													? 'border-success/30 bg-success/5 text-success hover:border-danger/30 hover:bg-danger/5 hover:text-danger'
													: 'border-border hover:border-accent/30 hover:bg-accent/5 text-text-muted',
											)}
										>
											{isSelected ? (
												<Check className="h-2.5 w-2.5" />
											) : (
												<Plus className="h-2.5 w-2.5 text-text-dim" />
											)}
											<span className="font-medium">{c.name}</span>
										</button>
										{explorerUrl && (
											<a
												href={explorerUrl}
												target="_blank"
												rel="noopener noreferrer"
												title="Verify on explorer"
												className="text-text-dim hover:text-accent transition-colors"
											>
												<ExternalLink className="h-2.5 w-2.5" />
											</a>
										)}
									</span>
								);
							})}
						</div>
					))}
				</div>
			)}

			{search.trim() && filtered.length === 0 && (
				<p className="text-[10px] text-text-dim">No match for "{search}"</p>
			)}

			{/* Add custom — inline toggle */}
			{chainId && (
				<CustomAddressInline
					chainId={chainId}
					isOpen={showCustom}
					onToggle={() => setShowCustom(!showCustom)}
					onAdd={onAdd}
				/>
			)}
		</div>
	);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  CustomAddressInline                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

function CustomAddressInline({
	chainId,
	isOpen,
	onToggle,
	onAdd,
}: {
	chainId: number;
	isOpen: boolean;
	onToggle: () => void;
	onAdd: (address: string) => void;
}) {
	const [address, setAddress] = useState('');
	const [label, setLabel] = useState('');
	const addressRef = useRef<HTMLInputElement>(null);
	const addContract = useAddContract();

	const handleSave = useCallback(() => {
		const addr = address.trim().toLowerCase();
		if (!addr.match(/^0x[0-9a-f]{40}$/i)) return;

		const name = label.trim() || `${addr.slice(0, 6)}...${addr.slice(-4)}`;
		addContract.mutate(
			{
				protocol: 'Custom',
				name,
				address: addr,
				chainId,
				contractType: 'custom',
				tags: ['custom', 'user-added'],
			},
			{
				onSuccess: () => {
					onAdd(addr);
					setAddress('');
					setLabel('');
				},
			},
		);
	}, [address, label, chainId, addContract, onAdd]);

	return (
		<div>
			{!isOpen ? (
				<button
					type="button"
					onClick={() => {
						onToggle();
						requestAnimationFrame(() => addressRef.current?.focus());
					}}
					className="inline-flex items-center gap-1 text-[10px] text-text-dim hover:text-accent transition-colors"
				>
					<Plus className="h-2.5 w-2.5" />
					Add unlisted contract
				</button>
			) : (
				<div className="flex items-center gap-1.5">
					<input
						ref={addressRef}
						type="text"
						placeholder="0x..."
						value={address}
						onChange={(e) => setAddress(e.target.value)}
						className="flex-1 min-w-0 rounded border border-border bg-background px-2 py-1 text-[10px] font-mono text-text placeholder:text-text-dim/40 focus:border-accent/40 focus:outline-none"
					/>
					<input
						type="text"
						placeholder="Label"
						value={label}
						onChange={(e) => setLabel(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') handleSave();
							if (e.key === 'Escape') onToggle();
						}}
						className="w-20 rounded border border-border bg-background px-2 py-1 text-[10px] text-text placeholder:text-text-dim/40 focus:border-accent/40 focus:outline-none"
					/>
					<button
						type="button"
						disabled={!address.match(/^0x[0-9a-f]{40}$/i) || addContract.isPending}
						onClick={handleSave}
						className="rounded bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent hover:bg-accent/20 disabled:opacity-30 transition-colors"
					>
						{addContract.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
					</button>
					<button
						type="button"
						onClick={() => {
							onToggle();
							setAddress('');
							setLabel('');
						}}
						className="text-[10px] text-text-dim hover:text-text transition-colors"
					>
						Cancel
					</button>
					{addContract.isError && (
						<span className="text-[9px] text-danger">
							{addContract.error instanceof Error && addContract.error.message.includes('409')
								? 'Exists'
								: 'Failed'}
						</span>
					)}
				</div>
			)}
		</div>
	);
}
