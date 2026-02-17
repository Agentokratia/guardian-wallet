import { useSigners } from '@/hooks/use-signers';
import { getTypeIcon } from '@/lib/signer-constants';
import { Command } from 'cmdk';
import { Activity, Plus, Search, Send, Settings, Shield } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function CommandPalette() {
	const [open, setOpen] = useState(false);
	const navigate = useNavigate();
	const { data: signers } = useSigners();

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				e.preventDefault();
				setOpen((prev) => !prev);
			}
		}
		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, []);

	const go = useCallback(
		(path: string) => {
			setOpen(false);
			navigate(path);
		},
		[navigate],
	);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-[60]">
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in-0 duration-150"
				onClick={() => setOpen(false)}
				onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
			/>

			{/* Command dialog */}
			<div className="relative mx-auto mt-[15vh] max-w-lg animate-in fade-in-0 zoom-in-95 slide-in-from-top-4 duration-200">
				<Command className="overflow-hidden rounded-xl border border-border bg-white shadow-2xl">
					<div className="flex items-center gap-2 border-b border-border px-4">
						<Search className="h-4 w-4 shrink-0 text-text-dim" />
						<Command.Input
							placeholder="Search accounts, pages..."
							className="flex h-12 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-dim"
						/>
						<kbd>esc</kbd>
					</div>
					<Command.List className="max-h-[320px] overflow-y-auto p-2">
						<Command.Empty className="px-4 py-8 text-center text-sm text-text-muted">
							No results found.
						</Command.Empty>

						{/* Pages */}
						<Command.Group
							heading="Pages"
							className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-text-dim"
						>
							<CommandItem
								onSelect={() => go('/signers')}
								icon={<Shield className="h-4 w-4" />}
								label="Dashboard"
								shortcut="D"
							/>
							<CommandItem
								onSelect={() => go('/audit')}
								icon={<Activity className="h-4 w-4" />}
								label="Activity"
								shortcut="A"
							/>
							<CommandItem
								onSelect={() => go('/settings')}
								icon={<Settings className="h-4 w-4" />}
								label="Settings"
								shortcut="S"
							/>
						</Command.Group>

						{/* Actions */}
						<Command.Group
							heading="Actions"
							className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-text-dim"
						>
							<CommandItem
								onSelect={() => go('/signers/new')}
								icon={<Plus className="h-4 w-4" />}
								label="Create new account"
							/>
							<CommandItem
								onSelect={() => go('/sign')}
								icon={<Send className="h-4 w-4" />}
								label="Send transaction"
							/>
						</Command.Group>

						{/* Accounts */}
						{signers && signers.length > 0 && (
							<Command.Group
								heading="Accounts"
								className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-text-dim"
							>
								{signers.map((signer) => (
									<CommandItem
										key={signer.id}
										onSelect={() => go(`/signers/${signer.id}`)}
										icon={getTypeIcon(signer.type, 'h-4 w-4')}
										label={signer.name}
										meta={`${signer.ethAddress.slice(0, 6)}...${signer.ethAddress.slice(-4)}`}
									/>
								))}
							</Command.Group>
						)}
					</Command.List>
				</Command>
			</div>
		</div>
	);
}

function CommandItem({
	onSelect,
	icon,
	label,
	meta,
	shortcut,
}: {
	onSelect: () => void;
	icon: React.ReactNode;
	label: string;
	meta?: string;
	shortcut?: string;
}) {
	return (
		<Command.Item
			onSelect={onSelect}
			className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-muted transition-colors data-[selected=true]:bg-surface-hover data-[selected=true]:text-text"
		>
			<span className="shrink-0 text-text-dim">{icon}</span>
			<span className="flex-1 truncate">{label}</span>
			{meta && <span className="shrink-0 font-mono text-[11px] text-text-dim">{meta}</span>}
			{shortcut && <kbd>{shortcut}</kbd>}
		</Command.Item>
	);
}
