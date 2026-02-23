/**
 * Policy builder — tabbed, centered content (max 512px).
 *
 * Design principles:
 * - All content in a narrow centered column → no mouse travel
 * - Input actions embedded (Enter-to-add, button inside input)
 * - Labels above inputs, not beside
 * - Tight spacing, zero wasted space
 */

import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { KnownContract } from '@/hooks/use-known-contracts';
import { useAllKnownContracts } from '@/hooks/use-known-contracts';
import type { BacktestResult } from '@/hooks/use-policies';
import { getExplorerAddressUrl } from '@/lib/chains';
import { cn } from '@/lib/utils';
import { CRITERION_CATALOG } from '@agentokratia/guardian-core';
import {
	AlertTriangle,
	CheckCircle2,
	Copy,
	CornerDownLeft,
	ExternalLink,
	FileText,
	Loader2,
	Plus,
	Shield,
	ShieldAlert,
	ShieldCheck,
	ShieldOff,
	Trash2,
	X,
	XCircle,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { isAddress } from 'viem';
import {
	type EnabledMap,
	type FormValues,
	buildRules,
	getDefaultFormValues,
	parseFormValues,
	validateAll,
} from './conversions';
import { CriterionFields } from './criterion-fields';
import { QuickAdd } from './quick-add';

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Timezone helpers — UI shows local hours, API stores UTC                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Offset in whole hours from UTC. E.g. UTC-5 → -5, UTC+2 → 2 */
const TZ_OFFSET_HOURS = -(new Date().getTimezoneOffset() / 60);

/** Short timezone label like "EST", "CET", "UTC+5:30" */
const TZ_LABEL = (() => {
	try {
		// Intl gives short names like "EST", "CET", "GMT+2"
		return (
			new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
				.formatToParts(new Date())
				.find((p) => p.type === 'timeZoneName')?.value ?? 'local'
		);
	} catch {
		return 'local';
	}
})();

function utcToLocal(utcHour: number): number {
	return (((utcHour + TZ_OFFSET_HOURS) % 24) + 24) % 24;
}

function localToUtc(localHour: number): number {
	return (((localHour - TZ_OFFSET_HOURS) % 24) + 24) % 24;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Constants                                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

const MAINNET_CHAINS = [
	{ id: 1, label: 'Ethereum' },
	{ id: 42161, label: 'Arbitrum' },
	{ id: 8453, label: 'Base' },
	{ id: 10, label: 'Optimism' },
	{ id: 137, label: 'Polygon' },
];

const TESTNET_CHAINS = [{ id: 11155111, label: 'Sepolia' }];

const TABS = [
	{ id: 'contracts', label: 'Contracts' },
	{ id: 'blocklist', label: 'Block List' },
	{ id: 'limits', label: 'Limits' },
	{ id: 'speed', label: 'Speed' },
	{ id: 'safety', label: 'Safety' },
	{ id: 'advanced', label: 'Advanced' },
] as const;

/** Human-readable tab descriptions + empty state nudges. Zero dev language. */
const TAB_INFO: Record<TabId, { description: string; emptyHint: string }> = {
	contracts: {
		description: 'Only allow transactions to these contracts.',
		emptyHint:
			'No trusted contracts set \u2014 your agent can interact with any contract. Add approved contracts to control where funds can go.',
	},
	blocklist: {
		description: 'Block transactions to specific addresses.',
		emptyHint:
			'No blocked addresses yet. Add known risky or unwanted addresses to automatically reject transactions to them.',
	},
	limits: {
		description: 'Cap how much your agent can spend.',
		emptyHint:
			'No spending limits set. Without caps, your agent can move unlimited value in a single transaction.',
	},
	speed: {
		description: 'Control how fast your agent can transact.',
		emptyHint:
			'No speed controls. Rate limits prevent your agent from sending too many transactions, and operating hours restrict when it can sign.',
	},
	safety: {
		description: 'Protect against common DeFi risks.',
		emptyHint:
			'No DeFi protections enabled. These checks guard against token drain attacks, excessive slippage, and front-running.',
	},
	advanced: {
		description:
			'Fine-grained controls for specific contract functions, IP restrictions, and chain limits.',
		emptyHint:
			'No advanced controls configured. These are optional \u2014 most agents are well-protected by the other tabs.',
	},
};

type TabId = (typeof TABS)[number]['id'];

/** Map criterion types to the tab where they live. */
const CRITERION_TAB: Record<string, TabId> = {
	evmAddress: 'contracts',
	evmAddressBlocked: 'blocklist',
	maxPerTxUsd: 'limits',
	dailyLimitUsd: 'limits',
	monthlyLimitUsd: 'limits',
	ethValue: 'limits',
	rateLimit: 'speed',
	timeWindow: 'speed',
	blockInfiniteApprovals: 'safety',
	maxSlippage: 'safety',
	mevProtection: 'safety',
	evmNetwork: 'advanced',
	evmFunction: 'advanced',
	ipAddress: 'advanced',
};

/** Pre-filtered criterion subsets — static, computed once at module load. */
const ADVANCED_CRITERIA = CRITERION_CATALOG.filter(
	(m) => m.category === 'advanced' || m.category === 'network',
);
const ALWAYS_ON_CRITERIA = CRITERION_CATALOG.filter((m) => m.alwaysOn);

/** Find the first tab that has a validation error. */
function findTabForError(errs: Record<string, string>): TabId | null {
	for (const tab of TABS) {
		for (const errType of Object.keys(errs)) {
			if (CRITERION_TAB[errType] === tab.id) return tab.id;
		}
	}
	return null;
}

/** Get set of tabs that have validation errors. */
function tabsWithErrors(errs: Record<string, string>): Set<TabId> {
	const s = new Set<TabId>();
	for (const errType of Object.keys(errs)) {
		const tab = CRITERION_TAB[errType];
		if (tab) s.add(tab);
	}
	return s;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Props                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface PolicyBuilderProps {
	initialRules?: Record<string, unknown>[];
	onSave: (rules: Record<string, unknown>[]) => void;
	onBacktest?: (rules: Record<string, unknown>[]) => Promise<BacktestResult>;
	onReset?: () => void;
	onLoadTemplate?: () => void;
	saving?: boolean;
	className?: string;
	compact?: boolean;
	chainId?: number;
}

export function PolicyBuilder({
	initialRules,
	onSave,
	onBacktest,
	onReset,
	onLoadTemplate,
	saving,
	className,
	compact,
	chainId,
}: PolicyBuilderProps) {
	const initial = useMemo(() => {
		if (initialRules && initialRules.length > 0) {
			return parseFormValues(initialRules);
		}
		return { values: getDefaultFormValues(), enabled: {} as EnabledMap };
	}, [initialRules]);

	const [values, setValues] = useState<FormValues>(initial.values);
	const [enabled, setEnabled] = useState<EnabledMap>(initial.enabled);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [activeTab, setActiveTab] = useState<TabId>('contracts');
	const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
	const [backtesting, setBacktesting] = useState(false);
	const [quickAddChain, setQuickAddChain] = useState<number>(chainId ?? 1);
	const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

	const { data: allContracts } = useAllKnownContracts();
	const contractsByAddress = useMemo(() => {
		const map = new Map<string, KnownContract>();
		if (allContracts) {
			for (const c of allContracts) {
				map.set(c.address.toLowerCase(), c);
			}
		}
		return map;
	}, [allContracts]);

	const advancedCriteria = ADVANCED_CRITERIA;
	const alwaysOnCriteria = ALWAYS_ON_CRITERIA;

	const whitelistAddresses = (values.evmAddress?.addresses as string[] | undefined) ?? [];
	const blockedAddresses = (values.evmAddressBlocked?.addresses as string[] | undefined) ?? [];

	/** Selected addresses that are NOT any known contract (truly custom / unlisted). */
	const extraWhitelist = useMemo(
		() => whitelistAddresses.filter((a) => !contractsByAddress.has(a.toLowerCase())),
		[whitelistAddresses, contractsByAddress],
	);

	/* ─── Handlers ─────────────────────────────────────────────────────────── */

	const handleFieldChange = useCallback((type: string, key: string, value: unknown) => {
		setValues((prev) => ({
			...prev,
			[type]: { ...prev[type], [key]: value },
		}));
		setErrors((prev) => {
			if (!prev[type]) return prev;
			const next = { ...prev };
			delete next[type];
			return next;
		});
	}, []);

	const handleAddressesChange = useCallback((type: string, addrs: string[]) => {
		setValues((prev) => ({
			...prev,
			[type]: { ...prev[type], addresses: addrs },
		}));
		setEnabled((prev) => ({ ...prev, [type]: addrs.length > 0 }));
		setErrors((prev) => {
			if (!prev[type]) return prev;
			const next = { ...prev };
			delete next[type];
			return next;
		});
	}, []);

	const handleLimitChange = useCallback((type: string, key: string, value: unknown) => {
		setValues((prev) => ({
			...prev,
			[type]: { ...prev[type], [key]: value },
		}));
		setEnabled((prev) => ({
			...prev,
			[type]: typeof value === 'number' && value > 0,
		}));
	}, []);

	const handleToggle = useCallback((type: string, on: boolean) => {
		setEnabled((prev) => ({ ...prev, [type]: on }));
		if (on) {
			// Initialize form values with defaults when enabling a criterion
			setValues((prev) => {
				if (prev[type] !== undefined) return prev;
				const meta = CRITERION_CATALOG.find((m) => m.type === type);
				if (!meta) return prev;
				return { ...prev, [type]: meta.fromCriterion({}) };
			});
		}
		if (!on) {
			setErrors((prev) => {
				if (!prev[type]) return prev;
				const next = { ...prev };
				delete next[type];
				return next;
			});
		}
	}, []);

	/** Clear all criteria belonging to a specific tab. */
	const handleClearTab = useCallback((tabId: TabId) => {
		const types = Object.entries(CRITERION_TAB)
			.filter(([, t]) => t === tabId)
			.map(([type]) => type);

		setEnabled((prev) => {
			const next = { ...prev };
			for (const t of types) next[t] = false;
			return next;
		});
		setValues((prev) => {
			const next = { ...prev };
			for (const t of types) {
				// Reset address lists to empty, other values to defaults
				if (t === 'evmAddress' || t === 'evmAddressBlocked') {
					next[t] = { ...next[t], addresses: [] };
				}
			}
			return next;
		});
		setErrors((prev) => {
			const next = { ...prev };
			for (const t of types) delete next[t];
			return next;
		});
	}, []);

	const handleQuickAdd = useCallback(
		(address: string) => {
			if (whitelistAddresses.includes(address.toLowerCase())) return;
			const updated = [...whitelistAddresses, address.toLowerCase()];
			setValues((prev) => ({
				...prev,
				evmAddress: { ...prev.evmAddress, addresses: updated },
			}));
			setEnabled((prev) => ({ ...prev, evmAddress: true }));
		},
		[whitelistAddresses],
	);

	const handleQuickRemove = useCallback(
		(address: string) => {
			handleAddressesChange(
				'evmAddress',
				whitelistAddresses.filter((a) => a !== address.toLowerCase()),
			);
		},
		[whitelistAddresses, handleAddressesChange],
	);

	const [saved, setSaved] = useState(false);
	const [prevSaving, setPrevSaving] = useState(false);

	// Detect saving→done transition to show success flash
	if (prevSaving && !saving) {
		setPrevSaving(false);
		setSaved(true);
	}
	if (saving && !prevSaving) {
		setPrevSaving(true);
		setSaved(false);
	}

	// Auto-clear saved state after 2.5s
	useEffect(() => {
		if (!saved) return;
		const t = setTimeout(() => setSaved(false), 2500);
		return () => clearTimeout(t);
	}, [saved]);

	const handleSave = useCallback(() => {
		const errs = validateAll(values, enabled);
		if (Object.keys(errs).length > 0) {
			setErrors(errs);
			// Switch to the first tab that has an error so the user sees it
			const errorTab = findTabForError(errs);
			if (errorTab) setActiveTab(errorTab);
			return;
		}
		setErrors({});
		onSave(buildRules(values, enabled));
	}, [values, enabled, onSave]);

	const handleBacktest = useCallback(async () => {
		if (!onBacktest) return;
		setBacktesting(true);
		try {
			const currentRules = buildRules(values, enabled);
			setBacktestResult(await onBacktest(currentRules));
		} catch {
			/* keep previous */
		} finally {
			setBacktesting(false);
		}
	}, [onBacktest, values, enabled]);

	const enabledCount = Object.values(enabled).filter(Boolean).length;
	const errorTabs = useMemo(() => tabsWithErrors(errors), [errors]);

	const tabHasRules: Record<TabId, boolean> = useMemo(
		() => ({
			contracts: whitelistAddresses.length > 0,
			blocklist: blockedAddresses.length > 0,
			limits: !!(
				enabled.maxPerTxUsd ||
				enabled.dailyLimitUsd ||
				enabled.monthlyLimitUsd ||
				enabled.ethValue
			),
			speed: !!(enabled.rateLimit || enabled.timeWindow),
			safety: !!(enabled.blockInfiniteApprovals || enabled.maxSlippage || enabled.mevProtection),
			advanced: advancedCriteria.some((c) => enabled[c.type]),
		}),
		[whitelistAddresses, blockedAddresses, enabled, advancedCriteria],
	);

	/* ─── Render ───────────────────────────────────────────────────────────── */

	return (
		<div className={cn('overflow-hidden rounded-xl border border-border bg-surface', className)}>
			{/* ── Protection status banner ─────────────────────────────────── */}
			<div
				className={cn(
					'flex items-center justify-between px-4 py-2 border-b',
					enabledCount > 0
						? 'border-success/10 bg-success/[0.03]'
						: 'border-warning/20 bg-warning/10',
				)}
			>
				<div className="flex items-center gap-2">
					{enabledCount > 0 ? (
						<>
							<ShieldCheck className="h-3.5 w-3.5 text-success" />
							<span className="text-[11px] font-semibold text-success">Guarded</span>
							<span className="text-[10px] text-text-dim">
								{enabledCount} active rule{enabledCount !== 1 ? 's' : ''}
							</span>
						</>
					) : (
						<>
							<ShieldOff className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
							<span className="text-[11px] font-semibold text-warning">No guardrails</span>
							<span className="text-[10px] text-warning/70">
								Every transaction will be signed automatically
							</span>
						</>
					)}
				</div>
				<div className="flex items-center gap-1.5">
					{onLoadTemplate && (
						<button
							type="button"
							onClick={onLoadTemplate}
							className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-accent transition-colors hover:bg-accent/10"
						>
							<FileText className="h-3 w-3" />
							Use template
						</button>
					)}
					{onReset && enabledCount > 0 && (
						<button
							type="button"
							onClick={() => setRemoveDialogOpen(true)}
							className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-text-dim transition-colors hover:bg-danger/10 hover:text-danger"
						>
							<ShieldOff className="h-3 w-3" />
							Remove all
						</button>
					)}
				</div>
			</div>

			{/* ── Tab bar ──────────────────────────────────────────────────── */}
			<div role="tablist" className="flex border-b border-border overflow-x-auto scrollbar-none">
				{TABS.map((tab) => (
					<button
						key={tab.id}
						type="button"
						role="tab"
						id={`tab-${tab.id}`}
						aria-selected={activeTab === tab.id}
						aria-controls={`tabpanel-${activeTab}`}
						onClick={() => setActiveTab(tab.id)}
						className={cn(
							'relative flex items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
							activeTab === tab.id
								? 'text-text bg-accent/[0.04]'
								: 'text-text-dim hover:text-text-muted hover:bg-accent/[0.05]',
						)}
					>
						{tab.label}
						{errorTabs.has(tab.id) ? (
							<span className="h-1.5 w-1.5 rounded-full bg-danger" />
						) : tabHasRules[tab.id] ? (
							<span
								className={cn(
									'h-1.5 w-1.5 rounded-full',
									activeTab === tab.id ? 'bg-accent' : 'bg-success',
								)}
							/>
						) : null}
						{activeTab === tab.id && (
							<span className="absolute inset-x-0 -bottom-px h-[2px] bg-accent" />
						)}
					</button>
				))}
			</div>

			{/* ── Tab content — centered narrow column ────────────────────── */}
			<div
				role="tabpanel"
				id={`tabpanel-${activeTab}`}
				aria-labelledby={`tab-${activeTab}`}
				className="px-4 py-4 animate-in fade-in duration-150"
			>
				<div className="mx-auto max-w-lg">
					{/* Tab description + clear button */}
					<div className="mb-3 flex items-start justify-between gap-4">
						<p className="text-[12px] text-text-muted leading-relaxed">
							{TAB_INFO[activeTab].description}
						</p>
						{tabHasRules[activeTab] && (
							<button
								type="button"
								onClick={() => handleClearTab(activeTab)}
								className="shrink-0 flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium text-text-dim transition-colors hover:bg-danger/10 hover:text-danger"
							>
								<Trash2 className="h-3 w-3" />
								Clear tab
							</button>
						)}
					</div>

					{/* ─── CONTRACTS ─── */}
					{activeTab === 'contracts' && (
						<div className="space-y-2.5">
							{/* ── Header row: chain + count ── */}
							<div className="flex items-center gap-2">
								<select
									value={quickAddChain}
									onChange={(e) => setQuickAddChain(Number(e.target.value))}
									className="h-7 shrink-0 rounded-md border border-border bg-background px-2 pr-6 text-[11px] text-text outline-none focus:ring-1 focus:ring-accent appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%239ca3af%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:10px] bg-[right_6px_center] bg-no-repeat"
								>
									<optgroup label="Mainnets">
										{MAINNET_CHAINS.map((c) => (
											<option key={c.id} value={c.id}>
												{c.label}
											</option>
										))}
									</optgroup>
									<optgroup label="Testnets">
										{TESTNET_CHAINS.map((c) => (
											<option key={c.id} value={c.id}>
												{c.label}
											</option>
										))}
									</optgroup>
								</select>

								{whitelistAddresses.length > 0 && (
									<span className="text-[10px] font-medium text-accent tabular-nums shrink-0">
										{whitelistAddresses.length} allowed
									</span>
								)}
							</div>

							{/* ── QuickAdd — toggleable chips, no scroll ── */}
							<QuickAdd
								chainId={quickAddChain}
								selectedAddresses={whitelistAddresses}
								onAdd={handleQuickAdd}
								onRemove={handleQuickRemove}
							/>

							{/* ── Cross-chain / custom addresses (only if not in QuickAdd) ── */}
							{extraWhitelist.length > 0 && (
								<div className="flex flex-wrap items-center gap-1">
									<span className="text-[9px] font-semibold uppercase tracking-wide text-text-dim w-16 shrink-0">
										Other
									</span>
									{extraWhitelist.map((addr) => {
										const contract = contractsByAddress.get(addr.toLowerCase());
										const label = contract?.name ?? `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
										return (
											<span
												key={addr}
												title={addr}
												className="inline-flex items-center rounded-full bg-accent/8 pl-1.5 pr-0.5 py-px text-[10px] group/pill"
											>
												<span className="text-text-muted">{label}</span>
												<button
													type="button"
													aria-label={`Remove ${label}`}
													onClick={() =>
														handleAddressesChange(
															'evmAddress',
															whitelistAddresses.filter((a) => a !== addr),
														)
													}
													className="rounded-full p-0.5 text-transparent group-hover/pill:text-text-dim hover:!text-danger transition-colors"
												>
													<X className="h-2 w-2" />
												</button>
											</span>
										);
									})}
								</div>
							)}

							{/* ── Manual address + warnings ── */}
							<EmbeddedAddressInput
								onAdd={(addr) => {
									if (!whitelistAddresses.includes(addr)) {
										handleAddressesChange('evmAddress', [...whitelistAddresses, addr]);
									}
								}}
							/>

							{/* ── Allow deploys — secondary option ── */}
							<label className="flex items-center gap-1.5 cursor-pointer">
								<Toggle
									checked={(values.evmAddress?.allowDeploy as boolean) ?? false}
									onChange={(v) => handleFieldChange('evmAddress', 'allowDeploy', v)}
									size="sm"
								/>
								<span className="text-[10px] text-text-dim">Allow creating new contracts</span>
							</label>

							{whitelistAddresses.length === 0 && (
								<div className="rounded-lg border border-warning/15 bg-warning/[0.03] px-3 py-2.5">
									<div className="flex items-start gap-2">
										<AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning mt-0.5" />
										<p className="text-[11px] leading-relaxed text-text-muted">
											{TAB_INFO.contracts.emptyHint}
										</p>
									</div>
								</div>
							)}

							{errors.evmAddress && (
								<p role="alert" className="text-[11px] text-danger">
									{errors.evmAddress}
								</p>
							)}
						</div>
					)}

					{/* ─── BLOCK LIST ─── */}
					{activeTab === 'blocklist' && (
						<div className="space-y-3">
							{blockedAddresses.length === 0 && (
								<div className="rounded-lg border border-border bg-surface-hover/30 px-3 py-2.5">
									<p className="text-[11px] leading-relaxed text-text-dim">
										{TAB_INFO.blocklist.emptyHint}
									</p>
								</div>
							)}

							{blockedAddresses.length > 0 && (
								<div className="space-y-1">
									{blockedAddresses.map((addr) => (
										<AddressChip
											key={addr}
											address={addr}
											chainId={quickAddChain}
											contract={contractsByAddress.get(addr.toLowerCase())}
											variant="danger"
											onRemove={() =>
												handleAddressesChange(
													'evmAddressBlocked',
													blockedAddresses.filter((a) => a !== addr),
												)
											}
										/>
									))}
								</div>
							)}

							<EmbeddedAddressInput
								onAdd={(addr) => {
									if (!blockedAddresses.includes(addr)) {
										handleAddressesChange('evmAddressBlocked', [...blockedAddresses, addr]);
									}
								}}
							/>

							{errors.evmAddressBlocked && (
								<p role="alert" className="text-[11px] text-danger">
									{errors.evmAddressBlocked}
								</p>
							)}
						</div>
					)}

					{/* ─── LIMITS ─── */}
					{activeTab === 'limits' && (
						<div className="space-y-2.5">
							{!enabled.maxPerTxUsd &&
								!enabled.dailyLimitUsd &&
								!enabled.monthlyLimitUsd &&
								!enabled.ethValue && (
									<div className="rounded-lg border border-warning/15 bg-warning/[0.03] px-3 py-2.5">
										<div className="flex items-start gap-2">
											<AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning mt-0.5" />
											<p className="text-[11px] leading-relaxed text-text-muted">
												{TAB_INFO.limits.emptyHint}
											</p>
										</div>
									</div>
								)}
							<div className="grid grid-cols-2 gap-2.5">
								<LimitCard
									label="Per transaction"
									prefix="$"
									suffix="USD"
									value={values.maxPerTxUsd?.maxUsd}
									onChange={(v) => handleLimitChange('maxPerTxUsd', 'maxUsd', v)}
									placeholder="2,000"
									hint="Typical: $500\u2013$5,000"
								/>
								<LimitCard
									label="Daily"
									prefix="$"
									suffix="USD"
									value={values.dailyLimitUsd?.maxUsd}
									onChange={(v) => handleLimitChange('dailyLimitUsd', 'maxUsd', v)}
									placeholder="5,000"
									hint="Typical: $5k\u2013$50k"
								/>
								<LimitCard
									label="Monthly"
									prefix="$"
									suffix="USD"
									value={values.monthlyLimitUsd?.maxUsd}
									onChange={(v) => handleLimitChange('monthlyLimitUsd', 'maxUsd', v)}
									placeholder="50,000"
									hint="Typical: $25k\u2013$500k"
								/>
								<LimitCard
									label="Max ETH per tx"
									suffix="ETH"
									value={values.ethValue?.value}
									onChange={(v) => handleLimitChange('ethValue', 'value', v)}
									placeholder="1.0"
									hint="Hard cap in native ETH"
								/>
							</div>
						</div>
					)}

					{/* ─── SPEED ─── */}
					{activeTab === 'speed' && (
						<div className="space-y-2.5">
							{!enabled.rateLimit && !enabled.timeWindow && (
								<div className="rounded-lg border border-border bg-surface-hover/30 px-3 py-2.5">
									<p className="text-[11px] leading-relaxed text-text-dim">
										{TAB_INFO.speed.emptyHint}
									</p>
								</div>
							)}
							<LimitCard
								label="Max transactions per hour"
								suffix="/ hour"
								value={values.rateLimit?.maxPerHour}
								onChange={(v) => handleLimitChange('rateLimit', 'maxPerHour', v)}
								placeholder="60"
							/>
							<div
								className={cn(
									'rounded-lg border p-3 transition-colors',
									enabled.timeWindow ? 'border-accent/30 bg-accent/5' : 'border-border',
								)}
							>
								<div className="flex items-center gap-2.5">
									<Toggle
										checked={enabled.timeWindow ?? false}
										onChange={(on) => handleToggle('timeWindow', on)}
										size="sm"
									/>
									<div className="flex-1">
										<span className="text-[12px] font-medium text-text">Operating hours</span>
										<p className="text-[10px] text-text-dim mt-0.5">
											Only allow signing during these hours
										</p>
									</div>
								</div>
								{(enabled.timeWindow ?? false) && (
									<div className="mt-2.5 flex items-center gap-2 pl-9">
										<Input
											type="number"
											min={0}
											max={23}
											value={
												values.timeWindow?.startHour !== undefined
													? String(utcToLocal(values.timeWindow.startHour as number))
													: ''
											}
											onChange={(e) =>
												handleFieldChange(
													'timeWindow',
													'startHour',
													e.target.value === '' ? undefined : localToUtc(Number(e.target.value)),
												)
											}
											placeholder="9"
											className="h-7 w-16 bg-background text-center text-xs"
										/>
										<span className="text-[11px] text-text-dim">to</span>
										<Input
											type="number"
											min={0}
											max={23}
											value={
												values.timeWindow?.endHour !== undefined
													? String(utcToLocal(values.timeWindow.endHour as number))
													: ''
											}
											onChange={(e) =>
												handleFieldChange(
													'timeWindow',
													'endHour',
													e.target.value === '' ? undefined : localToUtc(Number(e.target.value)),
												)
											}
											placeholder="17"
											className="h-7 w-16 bg-background text-center text-xs"
										/>
										<span className="text-[10px] text-text-dim">{TZ_LABEL}</span>
									</div>
								)}
							</div>
							{errors.rateLimit && (
								<p role="alert" className="text-[11px] text-danger">
									{errors.rateLimit}
								</p>
							)}
							{errors.timeWindow && (
								<p role="alert" className="text-[11px] text-danger">
									{errors.timeWindow}
								</p>
							)}
						</div>
					)}

					{/* ─── SAFETY ─── */}
					{activeTab === 'safety' && (
						<div className="space-y-2">
							{!enabled.blockInfiniteApprovals &&
								!enabled.maxSlippage &&
								!enabled.mevProtection && (
									<div className="rounded-lg border border-border bg-surface-hover/30 px-3 py-2.5">
										<p className="text-[11px] leading-relaxed text-text-dim">
											{TAB_INFO.safety.emptyHint}
										</p>
									</div>
								)}
							<SafetyRow
								label="Block unlimited token approvals"
								description="Prevents approve-all attacks that can drain full token balances"
								checked={enabled.blockInfiniteApprovals ?? false}
								onChange={(on) => handleToggle('blockInfiniteApprovals', on)}
							/>
							<SafetyRow
								label="Maximum swap slippage"
								description="Reject swaps where you lose more than this to price impact"
								checked={enabled.maxSlippage ?? false}
								onChange={(on) => handleToggle('maxSlippage', on)}
								error={errors.maxSlippage}
							>
								<div className="flex items-center gap-1">
									<Input
										type="number"
										min={0}
										max={100}
										value={
											values.maxSlippage?.maxPercent !== undefined
												? String(values.maxSlippage.maxPercent)
												: ''
										}
										onChange={(e) =>
											handleFieldChange(
												'maxSlippage',
												'maxPercent',
												e.target.value === '' ? undefined : Number(e.target.value),
											)
										}
										placeholder="2"
										className={cn(
											'h-6 w-14 bg-background text-[11px] text-center',
											errors.maxSlippage && 'border-danger ring-1 ring-danger/30',
										)}
									/>
									<span className="text-[10px] text-text-dim">%</span>
								</div>
							</SafetyRow>
							<SafetyRow
								label="Front-running protection"
								description="Flags swap transactions at risk of being front-run by other traders"
								badge="Warns only"
								checked={enabled.mevProtection ?? false}
								onChange={(on) => handleToggle('mevProtection', on)}
							/>
						</div>
					)}

					{/* ─── ADVANCED ─── */}
					{activeTab === 'advanced' && (
						<div className="space-y-2">
							{!advancedCriteria.some((c) => enabled[c.type]) && (
								<div className="rounded-lg border border-border bg-surface-hover/30 px-3 py-2.5">
									<p className="text-[11px] leading-relaxed text-text-dim">
										{TAB_INFO.advanced.emptyHint}
									</p>
								</div>
							)}
							{advancedCriteria.map((meta) => {
								const isOn = enabled[meta.type] ?? false;
								const hasFields = meta.fields.length > 0;
								return (
									<div
										key={meta.type}
										className={cn(
											'rounded-lg border p-3 transition-colors',
											isOn ? 'border-accent/30 bg-accent/5' : 'border-border',
										)}
									>
										<div className="flex items-center gap-2.5">
											<Toggle
												checked={isOn}
												onChange={(on) => handleToggle(meta.type, on)}
												size="sm"
											/>
											<div className="flex-1 min-w-0">
												<span className="text-[12px] font-medium text-text">{meta.label}</span>
												<p className="text-[10px] text-text-dim mt-0.5">{meta.description}</p>
											</div>
										</div>
										{isOn && hasFields && (
											<div className="mt-2 border-t border-border/50 pt-2 pl-9">
												<CriterionFields
													meta={meta}
													values={values[meta.type] ?? {}}
													onChange={(key, value) => handleFieldChange(meta.type, key, value)}
													error={errors[meta.type]}
												/>
											</div>
										)}
									</div>
								);
							})}
						</div>
					)}
				</div>
			</div>

			{/* ── Backtest result ───────────────────────────────────────────── */}
			{backtestResult && (
				<div className="border-t border-border" aria-live="polite">
					{/* Summary bar */}
					<div className="flex items-stretch divide-x divide-border">
						<div className="flex-1 px-4 py-3 text-center">
							<div className="text-[18px] font-bold tabular-nums text-text">
								{backtestResult.totalAnalyzed}
							</div>
							<div className="text-[10px] text-text-dim">transactions tested</div>
						</div>
						<div className="flex-1 px-4 py-3 text-center">
							<div className="text-[18px] font-bold tabular-nums text-success">
								{backtestResult.wouldPass}
							</div>
							<div className="text-[10px] text-text-dim">would pass</div>
						</div>
						<div className="flex-1 px-4 py-3 text-center">
							<div className="text-[18px] font-bold tabular-nums text-danger">
								{backtestResult.wouldBlock}
							</div>
							<div className="text-[10px] text-text-dim">would block</div>
						</div>
					</div>

					{/* Blocked list */}
					{backtestResult.blockedRequests.length > 0 && (
						<div className="border-t border-border">
							<div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim">
								Blocked transactions
							</div>
							<div className="divide-y divide-border/50">
								{backtestResult.blockedRequests.map((req) => (
									<div key={req.requestId} className="px-4 py-2.5">
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2">
												<XCircle className="h-3 w-3 shrink-0 text-danger" />
												<span className="font-mono text-[11px] text-text">
													{req.toAddress
														? `${req.toAddress.slice(0, 6)}...${req.toAddress.slice(-4)}`
														: 'Contract deploy'}
												</span>
											</div>
											<div className="flex items-center gap-2 text-[11px]">
												{req.valueUsd !== null && req.valueUsd > 0 && (
													<span className="tabular-nums text-text-muted">
														$
														{req.valueUsd < 0.01
															? '<0.01'
															: req.valueUsd.toLocaleString(undefined, {
																	minimumFractionDigits: 2,
																	maximumFractionDigits: 2,
																})}
													</span>
												)}
												<span className="text-[10px] text-text-dim">
													{new Date(req.createdAt).toLocaleDateString(undefined, {
														month: 'short',
														day: 'numeric',
													})}
												</span>
											</div>
										</div>
										<div className="mt-1 ml-5 text-[10px] text-danger/80">{req.reasons[0]}</div>
									</div>
								))}
							</div>
						</div>
					)}

					{/* All-pass message */}
					{backtestResult.totalAnalyzed > 0 && backtestResult.wouldBlock === 0 && (
						<div className="border-t border-border px-4 py-3 text-center">
							<span className="inline-flex items-center gap-1.5 text-[11px] text-success">
								<CheckCircle2 className="h-3.5 w-3.5" />
								All past transactions would have passed these rules
							</span>
						</div>
					)}

					{/* No history message */}
					{backtestResult.totalAnalyzed === 0 && (
						<div className="border-t border-border px-4 py-3 text-center">
							<span className="text-[11px] text-text-dim">
								No transaction history yet to test against
							</span>
						</div>
					)}
				</div>
			)}

			{/* ── Footer ───────────────────────────────────────────────────── */}
			{!compact && (
				<div className="border-t border-border px-4 py-2.5 space-y-1.5">
					<div className="flex items-center justify-between">
						<span className="text-[10px] text-text-dim" aria-live="polite">
							{Object.keys(errors).length > 0 ? (
								<span className="flex items-center gap-1 text-danger">
									<AlertTriangle className="h-3 w-3" />
									{Object.keys(errors).length} error{Object.keys(errors).length !== 1 ? 's' : ''} —
									fix to save
								</span>
							) : enabledCount === 0 ? (
								<span className="flex items-center gap-1 text-warning">
									<ShieldOff className="h-3 w-3" />
									Saving allows all transactions
								</span>
							) : (
								<span className="flex items-center gap-1 text-success">
									<ShieldCheck className="h-3 w-3" />
									{enabledCount} rule{enabledCount !== 1 ? 's' : ''} active
								</span>
							)}
						</span>
						<div className="flex items-center gap-1.5">
							{onBacktest && (
								<Button
									variant="outline"
									size="sm"
									onClick={handleBacktest}
									disabled={backtesting}
									className="h-7 text-[11px]"
								>
									{backtesting ? (
										<Loader2 className="mr-1 h-3 w-3 animate-spin" />
									) : (
										<Shield className="mr-1 h-3 w-3" />
									)}
									Test against history
								</Button>
							)}
							<Button
								size="sm"
								onClick={handleSave}
								disabled={saving || saved}
								className={cn(
									'h-9 px-4 text-[12px] font-medium transition-colors',
									saved && 'bg-success hover:bg-success',
								)}
							>
								{saving ? (
									<Loader2 className="mr-1 h-3 w-3 animate-spin" />
								) : saved ? (
									<CheckCircle2 className="mr-1 h-3 w-3" />
								) : null}
								{saved ? 'Guardrails Saved' : 'Save Guardrails'}
							</Button>
						</div>
					</div>
					{/* Built-in protections */}
					<div className="flex items-center gap-2 rounded-lg border border-success/15 bg-success/[0.04] px-3 py-2">
						<ShieldCheck className="h-3.5 w-3.5 text-success shrink-0" />
						<span className="text-[11px] text-text-muted">
							<span className="font-semibold text-text">
								{alwaysOnCriteria.length} built-in protections
							</span>{' '}
							always active — {alwaysOnCriteria.map((c) => c.label).join(', ')}
						</span>
					</div>
				</div>
			)}

			{compact && (
				<div className="border-t border-border p-4">
					<Button
						onClick={handleSave}
						disabled={saving || saved}
						className={cn('w-full transition-colors', saved && 'bg-success hover:bg-success')}
					>
						{saving ? (
							<Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
						) : saved ? (
							<CheckCircle2 className="mr-1.5 h-4 w-4" />
						) : null}
						{saved ? 'Guardrails saved' : 'Save guardrails'}
					</Button>
				</div>
			)}

			{/* ── Remove guardrails confirmation dialog ─────────────────── */}
			{onReset && (
				<RemoveGuardrailsDialog
					open={removeDialogOpen}
					onOpenChange={setRemoveDialogOpen}
					onConfirm={onReset}
					ruleCount={enabledCount}
				/>
			)}
		</div>
	);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Sub-components                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Address input with embedded add button — no mouse travel */
function EmbeddedAddressInput({ onAdd }: { onAdd: (addr: string) => void }) {
	const [input, setInput] = useState('');

	const add = useCallback(() => {
		const trimmed = input.trim().toLowerCase();
		if (!trimmed || !isAddress(trimmed)) return;
		onAdd(trimmed);
		setInput('');
	}, [input, onAdd]);

	return (
		<div className="relative">
			<Input
				value={input}
				onChange={(e) => setInput(e.target.value)}
				placeholder="Paste address, press Enter"
				className="h-8 bg-background font-mono text-[11px] pr-8"
				onKeyDown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						add();
					}
				}}
			/>
			<button
				type="button"
				onClick={add}
				className="absolute right-1 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded text-text-dim hover:text-accent hover:bg-accent/10 transition-colors"
				title="Add address (Enter)"
			>
				<CornerDownLeft className="h-3 w-3" />
			</button>
		</div>
	);
}

/** Address chip — shows protocol label, full address, copy, explorer link */
function AddressChip({
	address,
	chainId,
	contract,
	variant = 'default',
	onRemove,
}: {
	address: string;
	chainId?: number;
	contract?: KnownContract;
	variant?: 'default' | 'danger';
	onRemove: () => void;
}) {
	const isDanger = variant === 'danger';
	const [copied, setCopied] = useState(false);
	const explorerUrl = chainId ? getExplorerAddressUrl(chainId, address) : null;

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(address);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}, [address]);

	return (
		<div
			className={cn(
				'flex items-center gap-2 rounded-md border px-2.5 py-1.5 group/chip',
				isDanger ? 'border-danger/20 bg-danger/5' : 'border-border bg-background',
			)}
		>
			{/* Protocol badge */}
			{contract && (
				<span
					className={cn(
						'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold',
						isDanger ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent',
					)}
				>
					{contract.protocol}
				</span>
			)}

			{/* Contract name + address */}
			<div className="flex-1 min-w-0 flex items-baseline gap-1.5">
				{contract && (
					<span
						className={cn(
							'text-[11px] font-medium shrink-0',
							isDanger ? 'text-danger' : 'text-text',
						)}
					>
						{contract.name}
					</span>
				)}
				<span
					className={cn(
						'font-mono text-[10px] truncate',
						isDanger ? 'text-danger/60' : 'text-text-dim',
					)}
				>
					{address}
				</span>
			</div>

			{/* Actions — copy + explorer + remove */}
			<div className="flex items-center gap-1 shrink-0">
				<button
					type="button"
					onClick={handleCopy}
					title={copied ? 'Copied' : 'Copy address'}
					className={cn(
						'p-0.5 rounded transition-colors',
						isDanger ? 'text-danger/40 hover:text-danger' : 'text-text-dim hover:text-accent',
					)}
				>
					{copied ? (
						<CheckCircle2 className="h-3 w-3 text-success" />
					) : (
						<Copy className="h-3 w-3" />
					)}
				</button>
				{explorerUrl && (
					<a
						href={explorerUrl}
						target="_blank"
						rel="noopener noreferrer"
						title="View on explorer"
						className={cn(
							'p-0.5 rounded transition-colors',
							isDanger ? 'text-danger/40 hover:text-danger' : 'text-text-dim hover:text-accent',
						)}
					>
						<ExternalLink className="h-3 w-3" />
					</a>
				)}
				<button
					type="button"
					aria-label={`Remove ${contract?.name ?? address.slice(0, 6)}`}
					onClick={onRemove}
					className={cn(
						'p-0.5 rounded transition-colors',
						isDanger ? 'text-danger/40 hover:text-danger' : 'text-text-dim hover:text-danger',
					)}
				>
					<X className="h-3 w-3" />
				</button>
			</div>
		</div>
	);
}

/** Limit card — label above, input below, optional hint */
function LimitCard({
	label,
	prefix,
	suffix,
	value,
	onChange,
	placeholder,
	hint,
}: {
	label: string;
	prefix?: string;
	suffix?: string;
	value: unknown;
	onChange: (value: unknown) => void;
	placeholder?: string;
	hint?: string;
}) {
	const hasValue = value !== undefined && value !== '' && Number(value) !== 0;

	return (
		<div
			className={cn(
				'rounded-lg border p-3 transition-colors',
				hasValue ? 'border-accent/30 bg-accent/5' : 'border-border',
			)}
		>
			<span className="block text-[10px] font-medium text-text-dim mb-1.5">{label}</span>
			<div className="flex items-baseline gap-1">
				{prefix && <span className="text-base font-semibold text-text-muted">{prefix}</span>}
				<Input
					type="number"
					value={hasValue ? String(value) : ''}
					onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
					placeholder={placeholder ?? '\u2014'}
					min={0}
					className="h-7 flex-1 border-0 bg-transparent p-0 text-base font-semibold text-text shadow-none placeholder:text-text-dim/30 focus-visible:ring-0"
				/>
				{suffix && <span className="shrink-0 text-[10px] text-text-dim">{suffix}</span>}
			</div>
			{hint && !hasValue && (
				<span className="block mt-1.5 text-[10px] text-text-dim/60">{hint}</span>
			)}
		</div>
	);
}

/** Safety toggle row */
function SafetyRow({
	label,
	description,
	checked,
	onChange,
	badge,
	error,
	children,
}: {
	label: string;
	description?: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	badge?: string;
	error?: string;
	children?: ReactNode;
}) {
	return (
		<div
			className={cn(
				'rounded-lg border p-3 transition-colors',
				error
					? 'border-danger/40 bg-danger/5'
					: checked
						? 'border-accent/30 bg-accent/5'
						: 'border-border',
			)}
		>
			<div className="flex items-center gap-2.5">
				<Toggle checked={checked} onChange={onChange} size="sm" />
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-1.5">
						<span className="text-[12px] font-medium text-text">{label}</span>
						{badge && (
							<span className="rounded bg-warning/10 px-1.5 py-0.5 text-[9px] font-medium text-warning">
								{badge}
							</span>
						)}
					</div>
					{description && <p className="text-[10px] text-text-dim mt-0.5">{description}</p>}
				</div>
				{checked && children && <div className="shrink-0">{children}</div>}
			</div>
			{error && (
				<p role="alert" className="mt-1.5 pl-9 text-[10px] text-danger">
					{error}
				</p>
			)}
		</div>
	);
}

/** Destructive confirmation dialog — type "REMOVE" to confirm */
function RemoveGuardrailsDialog({
	open,
	onOpenChange,
	onConfirm,
	ruleCount,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	ruleCount: number;
}) {
	const [confirmText, setConfirmText] = useState('');
	const confirmed = confirmText === 'REMOVE';

	const handleConfirm = useCallback(() => {
		if (!confirmed) return;
		onConfirm();
		onOpenChange(false);
		setConfirmText('');
	}, [confirmed, onConfirm, onOpenChange]);

	return (
		<Dialog
			open={open}
			onOpenChange={(v) => {
				onOpenChange(v);
				if (!v) setConfirmText('');
			}}
		>
			<DialogContent className="max-w-sm border-danger/20 bg-background p-0 gap-0">
				{/* Danger header */}
				<div className="flex flex-col items-center px-6 pt-6 pb-4">
					<div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
						<ShieldAlert className="h-6 w-6 text-danger" />
					</div>
					<DialogHeader className="mt-4 items-center">
						<DialogTitle className="text-[15px] font-semibold text-text text-center">
							Remove all guardrails
						</DialogTitle>
						<DialogDescription className="text-[12px] text-text-muted text-center mt-1.5">
							This will remove{' '}
							{ruleCount > 0
								? `all ${ruleCount} active rule${ruleCount !== 1 ? 's' : ''}`
								: 'all rules'}
							. Every transaction will be allowed without any restrictions.
						</DialogDescription>
					</DialogHeader>
				</div>

				{/* Warning box */}
				<div className="mx-6 rounded-lg border border-danger/20 bg-danger/[0.04] px-3 py-2.5">
					<div className="flex items-start gap-2">
						<AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-danger" />
						<div className="text-[11px] text-danger/80 leading-relaxed">
							<p className="font-medium text-danger">This account will be fully exposed.</p>
							<p className="mt-1">
								No spending limits, no contract restrictions, no rate limits. Any connected agent
								can sign any transaction to any address.
							</p>
						</div>
					</div>
				</div>

				{/* Type to confirm */}
				<div className="px-6 pt-4 pb-2">
					<label className="block text-[11px] font-medium text-text-muted mb-1.5">
						Type <span className="font-mono font-bold text-danger">REMOVE</span> to confirm
					</label>
					<Input
						value={confirmText}
						onChange={(e) => setConfirmText(e.target.value)}
						placeholder="REMOVE"
						className={cn(
							'h-9 bg-background font-mono text-[13px] tracking-wider text-center transition-colors',
							confirmed && 'border-danger ring-1 ring-danger/30',
						)}
						autoFocus
						onKeyDown={(e) => {
							if (e.key === 'Enter' && confirmed) handleConfirm();
						}}
					/>
				</div>

				{/* Actions */}
				<div className="flex items-center gap-2 px-6 pt-2 pb-5">
					<Button
						variant="outline"
						className="flex-1 h-9 text-[12px]"
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button
						disabled={!confirmed}
						onClick={handleConfirm}
						className={cn(
							'flex-1 h-9 text-[12px] transition-colors',
							confirmed
								? 'bg-danger text-white hover:bg-danger/90'
								: 'bg-danger/20 text-danger/40 cursor-not-allowed',
						)}
					>
						<Trash2 className="mr-1.5 h-3.5 w-3.5" />
						Remove all guardrails
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function Toggle({
	checked,
	onChange,
	size = 'default',
}: {
	checked: boolean;
	onChange: (checked: boolean) => void;
	size?: 'default' | 'sm';
}) {
	const isSmall = size === 'sm';
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			onClick={() => onChange(!checked)}
			className={cn(
				'relative shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
				isSmall ? 'h-4 w-7' : 'h-5 w-9',
				checked ? 'bg-accent' : 'bg-border',
			)}
		>
			<span
				className={cn(
					'absolute top-0.5 rounded-full bg-white transition-transform',
					isSmall ? 'h-3 w-3' : 'h-4 w-4',
					checked ? (isSmall ? 'left-[14px]' : 'left-[18px]') : 'left-0.5',
				)}
			/>
		</button>
	);
}
