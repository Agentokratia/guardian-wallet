import { PolicyBuilder } from '@/components/policy-builder/policy-builder';
import { Input } from '@/components/ui/input';
import { useAllPolicyTemplates } from '@/hooks/use-policy-templates';
import {
	useCreateTemplate,
	useDeleteTemplate,
	useUpdateTemplate,
} from '@/hooks/use-template-mutations';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
	ArrowLeft,
	Bot,
	Eye,
	EyeOff,
	FileText,
	Loader2,
	Rocket,
	Server,
	Shield,
	Trash2,
	Users,
	Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Constants                                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

const ICON_OPTIONS = [
	{ value: 'shield', Icon: Shield },
	{ value: 'zap', Icon: Zap },
	{ value: 'file', Icon: FileText },
	{ value: 'bot', Icon: Bot },
	{ value: 'rocket', Icon: Rocket },
	{ value: 'server', Icon: Server },
	{ value: 'users', Icon: Users },
];

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Page                                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function TemplateEditPage() {
	const { templateId } = useParams<{ templateId: string }>();
	const isNew = !templateId;
	const navigate = useNavigate();
	const { toast } = useToast();

	const { data: templates, isLoading: templatesLoading } = useAllPolicyTemplates();

	const template = useMemo(
		() => (templateId ? templates?.find((t) => t.id === templateId) : null),
		[templateId, templates],
	);

	// Form state
	const [name, setName] = useState('');
	const [slug, setSlug] = useState('');
	const [description, setDescription] = useState('');
	const [icon, setIcon] = useState('shield');
	const [visible, setVisible] = useState(true);
	const [sortOrder, setSortOrder] = useState(100);
	const [rules, setRules] = useState<Record<string, unknown>[]>([]);
	const [confirmDelete, setConfirmDelete] = useState(false);

	const slugTouched = useRef(false);
	const initialized = useRef(false);

	// Mutations
	const createMutation = useCreateTemplate();
	const updateMutation = useUpdateTemplate();
	const deleteMutation = useDeleteTemplate();
	const saving = createMutation.isPending || updateMutation.isPending;

	// Populate form from template (edit mode)
	useEffect(() => {
		if (template && !initialized.current) {
			setName(template.name);
			setSlug(template.slug);
			setDescription(template.description ?? '');
			setIcon(template.icon ?? 'shield');
			setVisible(template.visible);
			setSortOrder(template.sortOrder);
			setRules(template.rules);
			slugTouched.current = true;
			initialized.current = true;
		}
	}, [template]);

	// Reset initialized ref when switching between templates
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset when templateId changes
	useEffect(() => {
		initialized.current = false;
	}, [templateId]);

	const handleNameChange = useCallback((value: string) => {
		setName(value);
		if (!slugTouched.current) {
			setSlug(
				value
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '-')
					.replace(/^-|-$/g, ''),
			);
		}
	}, []);

	const handleRulesSave = useCallback((newRules: Record<string, unknown>[]) => {
		setRules(newRules);
	}, []);

	const handleSave = useCallback(async () => {
		if (!name.trim() || !slug.trim()) {
			toast({ title: 'Name and slug are required', variant: 'destructive' });
			return;
		}

		try {
			if (!isNew && template) {
				await updateMutation.mutateAsync({
					id: template.id,
					name: name.trim(),
					slug: slug.trim(),
					description: description.trim() || undefined,
					icon,
					rules,
					sortOrder,
					visible,
				});
				toast({ title: 'Template updated' });
			} else {
				await createMutation.mutateAsync({
					name: name.trim(),
					slug: slug.trim(),
					description: description.trim() || undefined,
					icon,
					rules,
					sortOrder,
					visible,
				});
				toast({ title: 'Template created' });
				navigate('/templates', { replace: true });
			}
		} catch {
			toast({ title: 'Failed to save template', variant: 'destructive' });
		}
	}, [
		isNew,
		template,
		name,
		slug,
		description,
		icon,
		rules,
		sortOrder,
		visible,
		createMutation,
		updateMutation,
		toast,
		navigate,
	]);

	const handleDelete = useCallback(async () => {
		if (!template) return;
		if (!confirmDelete) {
			setConfirmDelete(true);
			return;
		}
		try {
			await deleteMutation.mutateAsync(template.id);
			toast({ title: 'Template deleted' });
			navigate('/templates', { replace: true });
		} catch {
			toast({ title: 'Failed to delete template', variant: 'destructive' });
		}
	}, [template, confirmDelete, deleteMutation, toast, navigate]);

	// 404
	if (!isNew && !templatesLoading && templates && !template) {
		return (
			<div className="flex flex-col items-center justify-center py-24 text-center animate-page-enter">
				<Shield className="h-8 w-8 text-text-dim/30 mb-3" />
				<h2 className="text-[15px] font-semibold text-text">Template not found</h2>
				<p className="mt-1 text-[12px] text-text-muted">This template may have been deleted.</p>
				<Link
					to="/templates"
					className="mt-4 text-[12px] font-medium text-accent hover:text-accent/80 transition-colors"
				>
					Back to templates
				</Link>
			</div>
		);
	}

	// Loading
	if (!isNew && templatesLoading) {
		return (
			<div className="flex items-center justify-center py-24">
				<Loader2 className="h-5 w-5 animate-spin text-text-dim" />
			</div>
		);
	}

	return (
		<div className="animate-page-enter">
			{/* ─── Top bar ─── */}
			<div className="flex items-center justify-between mb-5">
				<div className="flex items-center gap-3 min-w-0">
					<Link
						to="/templates"
						className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-text-dim hover:bg-surface-hover hover:text-text transition-colors"
					>
						<ArrowLeft className="h-3.5 w-3.5" />
					</Link>
					<div className="min-w-0">
						<h1 className="text-[15px] font-bold text-text truncate">
							{isNew ? 'New Template' : (template?.name ?? 'Edit Template')}
						</h1>
						{!isNew && template?.slug && (
							<span className="text-[11px] font-mono text-text-dim">{template.slug}</span>
						)}
					</div>
				</div>

				<div className="flex items-center gap-2 shrink-0">
					{!isNew && (
						<button
							type="button"
							onClick={handleDelete}
							disabled={deleteMutation.isPending}
							className={cn(
								'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors',
								confirmDelete
									? 'border-danger/30 bg-danger/5 text-danger hover:bg-danger/10'
									: 'border-border text-text-dim hover:border-danger/30 hover:text-danger',
							)}
						>
							{deleteMutation.isPending ? (
								<Loader2 className="h-3 w-3 animate-spin" />
							) : (
								<Trash2 className="h-3 w-3" />
							)}
							{confirmDelete ? 'Confirm delete' : 'Delete'}
						</button>
					)}
					<button
						type="button"
						onClick={handleSave}
						disabled={saving}
						className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
					>
						{saving && <Loader2 className="h-3 w-3 animate-spin" />}
						{isNew ? 'Create template' : 'Save changes'}
					</button>
				</div>
			</div>

			{/* ─── Metadata section ─── */}
			<div className="rounded-lg border border-border bg-surface p-4 mb-4">
				<div className="grid gap-4 sm:grid-cols-2">
					{/* Name */}
					<div>
						<label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
							Name
						</label>
						<Input
							value={name}
							onChange={(e) => handleNameChange(e.target.value)}
							placeholder="Trading Bot — Standard"
							className="mt-1"
						/>
					</div>

					{/* Slug */}
					<div>
						<label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
							Slug
						</label>
						<Input
							value={slug}
							onChange={(e) => {
								slugTouched.current = true;
								setSlug(e.target.value);
							}}
							placeholder="trading-bot"
							className="mt-1 font-mono text-[12px]"
						/>
					</div>

					{/* Description — full width */}
					<div className="sm:col-span-2">
						<label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
							Description
						</label>
						<textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Brief description of this template..."
							rows={2}
							className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-text placeholder:text-text-dim focus:outline-none focus:ring-2 focus:ring-accent/40 resize-none"
						/>
					</div>
				</div>

				{/* Icon + Visible + Sort — compact row */}
				<div className="flex items-end gap-4 mt-4 pt-4 border-t border-border/60">
					{/* Icon picker */}
					<div className="flex-1">
						<label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
							Icon
						</label>
						<div className="mt-1.5 flex gap-1">
							{ICON_OPTIONS.map(({ value, Icon }) => (
								<button
									key={value}
									type="button"
									onClick={() => setIcon(value)}
									className={cn(
										'flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
										icon === value
											? 'border-accent bg-accent/10 text-accent'
											: 'border-border text-text-dim hover:border-accent/30 hover:text-text-muted',
									)}
								>
									<Icon className="h-3.5 w-3.5" />
								</button>
							))}
						</div>
					</div>

					{/* Visible toggle */}
					<button
						type="button"
						onClick={() => setVisible(!visible)}
						className={cn(
							'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors',
							visible
								? 'border-success/30 bg-success/5 text-success'
								: 'border-border bg-background text-text-dim',
						)}
					>
						{visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
						{visible ? 'Visible' : 'Hidden'}
					</button>

					{/* Sort order */}
					<div className="w-20">
						<label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
							Order
						</label>
						<Input
							type="number"
							value={sortOrder}
							onChange={(e) => setSortOrder(Number(e.target.value))}
							className="mt-1"
						/>
					</div>
				</div>
			</div>

			{/* ─── Rules (PolicyBuilder) ─── */}
			<div className="rounded-lg border border-border bg-surface p-4">
				<div className="mb-3 flex items-center justify-between">
					<span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
						Rules ({rules.length})
					</span>
				</div>
				<PolicyBuilder initialRules={rules} onSave={handleRulesSave} compact />
			</div>
		</div>
	);
}
