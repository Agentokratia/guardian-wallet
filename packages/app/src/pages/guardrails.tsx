import { BadgeDialog } from '@/components/certification/badge-dialog';
import { CertificationCard } from '@/components/certification/certification-card';
import { PolicyBuilder } from '@/components/policy-builder/policy-builder';
import { SignerSubnav } from '@/components/signer-subnav';
import { useCertification } from '@/hooks/use-certification';
import { useBacktestPolicy, usePolicy, useSavePolicy } from '@/hooks/use-policies';
import { usePolicyTemplates } from '@/hooks/use-policy-templates';
import { useSigner } from '@/hooks/use-signer';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
	Bot,
	ChevronRight,
	FileText,
	Loader2,
	Rocket,
	Server,
	Shield,
	ShieldCheck,
	Users,
	Zap,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

const TEMPLATE_ICONS: Record<string, typeof Shield> = {
	shield: Shield,
	zap: Zap,
	file: FileText,
	bot: Bot,
	rocket: Rocket,
	server: Server,
	users: Users,
};

/* -------------------------------------------------------------------------- */
/*  Template picker (reusable for empty + unrestricted + dialog)               */
/* -------------------------------------------------------------------------- */

function TemplatePicker({
	templates,
	onSelect,
	onScratch,
	compact,
}: {
	templates: {
		id: string;
		name: string;
		description: string;
		icon: string;
		rules: Record<string, unknown>[];
	}[];
	onSelect: (rules: Record<string, unknown>[]) => void;
	onScratch: () => void;
	compact?: boolean;
}) {
	return (
		<div>
			<div
				className={cn('grid gap-2', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3')}
			>
				{templates.map((t) => {
					const Icon = TEMPLATE_ICONS[t.icon] ?? Shield;
					return (
						<button
							key={t.id}
							type="button"
							onClick={() => onSelect(t.rules)}
							className="group flex items-start gap-3 rounded-lg border border-border p-3 text-left transition-[border-color,background-color,transform,box-shadow] hover:border-accent/20 hover:bg-surface-hover hover:-translate-y-px hover:shadow-sm"
						>
							<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/[0.06] transition-colors group-hover:bg-accent/10">
								<Icon className="h-3.5 w-3.5 text-text-muted transition-colors group-hover:text-text" />
							</div>
							<div className="min-w-0">
								<div className="text-[12px] font-semibold text-text">{t.name}</div>
								<p className="mt-0.5 text-[10px] leading-relaxed text-text-muted line-clamp-2">
									{t.description}
								</p>
								<span className="mt-1 inline-block text-[10px] text-text-dim">
									{t.rules.length} rule{t.rules.length !== 1 ? 's' : ''}
								</span>
							</div>
						</button>
					);
				})}
			</div>
			<div className={cn('text-center', compact ? 'mt-2' : 'border-t border-border mt-4 pt-3')}>
				<button
					type="button"
					onClick={onScratch}
					className="inline-flex items-center gap-1 text-[12px] font-medium text-text-muted hover:text-text transition-colors"
				>
					Or start from scratch
					<ChevronRight className="h-3 w-3" />
				</button>
			</div>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/*  Main page                                                                  */
/* -------------------------------------------------------------------------- */

export function GuardrailsPage() {
	const { id } = useParams<{ id: string }>();
	const signerId = id ?? '';
	const { toast } = useToast();

	const { data: signer } = useSigner(signerId);
	const { data: policyDoc, isLoading: policiesLoading } = usePolicy(signerId);
	const { data: templates } = usePolicyTemplates();
	const certification = useCertification(signerId);

	const [policySaving, setPolicySaving] = useState(false);
	const [showBuilder, setShowBuilder] = useState(false);
	const [badgeOpen, setBadgeOpen] = useState(false);
	const [templateRules, setTemplateRules] = useState<Record<string, unknown>[] | null>(null);
	const [showTemplatePicker, setShowTemplatePicker] = useState(false);

	// Key counter forces PolicyBuilder remount when template changes
	const builderKeyRef = useRef(0);

	const { mutateAsync: savePolicyAsync } = useSavePolicy();
	const { mutateAsync: backtestAsync } = useBacktestPolicy();

	const initialRules = useMemo(() => {
		if (templateRules) return templateRules;
		if (policyDoc?.rules) return policyDoc.rules;
		return [];
	}, [templateRules, policyDoc]);

	const hasExistingPolicy = (policyDoc && initialRules.length > 0) || showBuilder;
	const isUnrestricted = !!policyDoc && policyDoc.rules.length === 0 && !showBuilder;

	const handlePolicySave = useCallback(
		async (rules: Record<string, unknown>[]) => {
			setPolicySaving(true);
			try {
				await savePolicyAsync({ signerId, rules });
				toast({ title: 'Guardrails saved', description: 'Your policy is now active.' });
				setTemplateRules(null);
				setShowTemplatePicker(false);
			} catch {
				toast({ title: 'Error', description: 'Failed to save.', variant: 'destructive' });
			} finally {
				setPolicySaving(false);
			}
		},
		[signerId, savePolicyAsync, toast],
	);

	const handleBacktest = useCallback(() => backtestAsync(signerId), [signerId, backtestAsync]);

	const handleTemplateSelect = useCallback((rules: Record<string, unknown>[]) => {
		builderKeyRef.current += 1;
		setTemplateRules(rules);
		setShowBuilder(true);
		setShowTemplatePicker(false);
	}, []);

	const handleScratch = useCallback(() => {
		builderKeyRef.current += 1;
		setTemplateRules(null);
		setShowBuilder(true);
		setShowTemplatePicker(false);
	}, []);

	const handleLoadTemplate = useCallback(() => {
		setShowTemplatePicker(true);
	}, []);

	const handleReset = useCallback(async () => {
		setPolicySaving(true);
		try {
			await savePolicyAsync({ signerId, rules: [] });
			toast({ title: 'Guardrails removed', description: 'All transactions are now allowed.' });
			setTemplateRules(null);
			setShowBuilder(false);
			setShowTemplatePicker(false);
		} catch {
			toast({
				title: 'Error',
				description: 'Failed to remove guardrails.',
				variant: 'destructive',
			});
		} finally {
			setPolicySaving(false);
		}
	}, [signerId, savePolicyAsync, toast]);

	return (
		<SignerSubnav>
			<div className="space-y-4">
				{/* ─── Empty / unrestricted — single empty state ─── */}
				{(isUnrestricted || (!hasExistingPolicy && !policiesLoading)) && !policiesLoading && (
					<div
						className={cn(
							'overflow-hidden rounded-xl border',
							isUnrestricted ? 'border-warning/20 bg-warning/[0.03]' : 'border-border bg-surface',
						)}
					>
						<div className="px-6 py-6 text-center">
							<div
								className={cn(
									'mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl',
									isUnrestricted ? 'bg-warning/10' : 'bg-accent/[0.06]',
								)}
							>
								<Shield
									className={cn('h-5 w-5', isUnrestricted ? 'text-warning' : 'text-text-dim')}
								/>
							</div>
							<h3 className="text-[15px] font-semibold text-text">
								{isUnrestricted ? 'No restrictions active' : 'Set up guardrails'}
							</h3>
							<p className="mt-1 text-[12px] text-text-muted max-w-md mx-auto">
								{isUnrestricted
									? 'Your agent can send any transaction to any address without limits. Add guardrails to control what it can do.'
									: 'Pick a template or start from scratch. You can change everything later.'}
							</p>
						</div>

						{templates && templates.length > 0 ? (
							<div
								className={cn(
									'border-t px-5 py-4',
									isUnrestricted ? 'border-warning/10' : 'border-border',
								)}
							>
								{isUnrestricted && (
									<p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim">
										Quick start with a template
									</p>
								)}
								<TemplatePicker
									templates={templates}
									onSelect={handleTemplateSelect}
									onScratch={handleScratch}
									compact={isUnrestricted}
								/>
							</div>
						) : (
							<div
								className={cn(
									'border-t px-5 py-4',
									isUnrestricted ? 'border-warning/10' : 'border-border',
								)}
							>
								{isUnrestricted ? (
									<div className="text-center">
										<button
											type="button"
											onClick={handleScratch}
											className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[12px] font-medium text-white hover:bg-accent/90 transition-colors"
										>
											<ShieldCheck className="h-3.5 w-3.5" />
											Add guardrails
										</button>
									</div>
								) : (
									<div className="grid gap-2 sm:grid-cols-3">
										{[1, 2, 3].map((i) => (
											<div key={i} className="h-20 rounded-lg bg-surface-hover animate-pulse" />
										))}
									</div>
								)}
							</div>
						)}
					</div>
				)}

				{/* Loading skeleton */}
				{policiesLoading && (
					<div className="flex items-center justify-center rounded-xl border border-border bg-surface py-12">
						<Loader2 className="h-5 w-5 animate-spin text-text-dim" />
					</div>
				)}

				{/* ─── Template picker overlay (from "Use template" in builder) ─── */}
				{showTemplatePicker && hasExistingPolicy && templates && templates.length > 0 && (
					<div className="overflow-hidden rounded-xl border border-accent/20 bg-surface animate-in fade-in slide-in-from-top-2 duration-200">
						<div className="flex items-center justify-between border-b border-border px-4 py-3">
							<div>
								<h4 className="text-[13px] font-semibold text-text">Choose a template</h4>
								<p className="text-[10px] text-text-muted mt-0.5">
									This will replace your current rules. You can still edit everything after.
								</p>
							</div>
							<button
								type="button"
								onClick={() => setShowTemplatePicker(false)}
								className="text-[11px] font-medium text-text-dim hover:text-text transition-colors"
							>
								Cancel
							</button>
						</div>
						<div className="px-4 py-3">
							<TemplatePicker
								templates={templates}
								onSelect={handleTemplateSelect}
								onScratch={() => setShowTemplatePicker(false)}
								compact
							/>
						</div>
					</div>
				)}

				{/* ─── Policy Builder ─── */}
				{hasExistingPolicy && !policiesLoading && (
					<PolicyBuilder
						key={builderKeyRef.current}
						initialRules={initialRules}
						onSave={handlePolicySave}
						onBacktest={handleBacktest}
						onReset={handleReset}
						onLoadTemplate={templates && templates.length > 0 ? handleLoadTemplate : undefined}
						saving={policySaving}
					/>
				)}

				{/* ─── Certification Card (full breakdown + next step) ─── */}
				{certification && signer && !policiesLoading && (
					<CertificationCard
						cert={certification}
						address={signer.ethAddress}
						name={signer.name}
						onGetBadge={() => setBadgeOpen(true)}
					/>
				)}
			</div>

			{/* ─── Badge dialog ─── */}
			{certification && signer && (
				<BadgeDialog
					open={badgeOpen}
					onOpenChange={setBadgeOpen}
					cert={certification}
					address={signer.ethAddress}
					name={signer.name}
				/>
			)}
		</SignerSubnav>
	);
}
