import type { PolicyTemplate } from '@/hooks/use-policy-templates';
import { useAllPolicyTemplates } from '@/hooks/use-policy-templates';
import { cn } from '@/lib/utils';
import {
	Bot,
	EyeOff,
	FileText,
	Loader2,
	Plus,
	Rocket,
	Server,
	Shield,
	Users,
	Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';

const TEMPLATE_ICONS: Record<string, typeof Shield> = {
	shield: Shield,
	zap: Zap,
	file: FileText,
	bot: Bot,
	rocket: Rocket,
	server: Server,
	users: Users,
};

export function TemplatesPage() {
	const { data: templates, isLoading } = useAllPolicyTemplates();

	return (
		<div className="space-y-4 animate-page-enter">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-[17px] font-bold text-text">Guardrail Templates</h1>
					<p className="mt-0.5 text-[12px] text-text-muted">
						Manage reusable guardrail configurations.
					</p>
				</div>
				<Link
					to="/templates/new"
					className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-accent/90"
				>
					<Plus className="h-3.5 w-3.5" />
					Create Template
				</Link>
			</div>

			{/* Loading */}
			{isLoading && (
				<div className="flex items-center justify-center rounded-xl border border-border bg-surface py-16">
					<Loader2 className="h-5 w-5 animate-spin text-text-dim" />
				</div>
			)}

			{/* Empty */}
			{!isLoading && templates?.length === 0 && (
				<div className="flex flex-col items-center justify-center rounded-xl border border-border bg-surface py-16 text-center">
					<div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent/[0.06]">
						<Shield className="h-5 w-5 text-text-dim" />
					</div>
					<h3 className="text-[14px] font-semibold text-text">No templates yet</h3>
					<p className="mt-1 text-[12px] text-text-muted">
						Create your first template to reuse guardrail configs.
					</p>
				</div>
			)}

			{/* Grid */}
			{!isLoading && templates && templates.length > 0 && (
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{templates.map((t) => (
						<TemplateCard key={t.id} template={t} />
					))}
				</div>
			)}
		</div>
	);
}

function TemplateCard({ template: t }: { template: PolicyTemplate }) {
	const Icon = TEMPLATE_ICONS[t.icon] ?? Shield;
	return (
		<Link
			to={`/templates/${t.id}`}
			className="group relative flex items-start gap-3 rounded-lg border border-border bg-surface p-4 text-left transition-[border-color,background-color] hover:border-accent/20 hover:bg-surface-hover"
		>
			{!t.visible && (
				<span className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-surface-hover px-1.5 py-0.5 text-[9px] font-semibold text-text-dim uppercase tracking-wider">
					<EyeOff className="h-2.5 w-2.5" />
					Hidden
				</span>
			)}
			<div
				className={cn(
					'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
					t.visible ? 'bg-accent/[0.06]' : 'bg-surface-hover',
				)}
			>
				<Icon className={cn('h-4 w-4', t.visible ? 'text-accent' : 'text-text-dim')} />
			</div>
			<div className="min-w-0 flex-1">
				<div className="text-[13px] font-semibold text-text">{t.name}</div>
				{t.description && (
					<p className="mt-0.5 text-[11px] leading-relaxed text-text-muted line-clamp-2">
						{t.description}
					</p>
				)}
				<div className="mt-1.5 flex items-center gap-2">
					<span className="text-[10px] text-text-dim">
						{t.rules.length} rule{t.rules.length !== 1 ? 's' : ''}
					</span>
				</div>
			</div>
		</Link>
	);
}
