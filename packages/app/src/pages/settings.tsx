import { Header } from '@/components/layout/header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dot } from '@/components/ui/dot';
import { Mono } from '@/components/ui/mono';
import { Pill } from '@/components/ui/pill';
import { Separator } from '@/components/ui/separator';
import { useHealth } from '@/hooks/use-health';
import { useNetworks } from '@/hooks/use-networks';
import { Loader2 } from 'lucide-react';

function formatUptime(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (hours < 24) return `${hours}h ${minutes}m`;
	const days = Math.floor(hours / 24);
	return `${days}d ${hours % 24}h`;
}

export function SettingsPage() {
	const { data: health, isLoading: healthLoading } = useHealth();
	const { data: networks, isLoading: networksLoading } = useNetworks();

	const vaultConnected = health?.vault?.connected ?? false;
	const serverUptime = health?.uptime ?? 0;
	const dbConnected = health?.db ?? false;

	return (
		<>
			<Header title="Settings" subtitle={<Mono size="sm">Server configuration</Mono>} />

			<div className="grid gap-6 max-w-3xl">
				<Card>
					<CardHeader>
						<CardTitle className="text-base">System Status</CardTitle>
						<CardDescription>
							Real-time health of the services that power signing operations
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{healthLoading ? (
							<div className="flex items-center gap-2 text-sm text-text-muted">
								<Loader2 className="h-4 w-4 animate-spin" />
								Checking status...
							</div>
						) : (
							<>
								<div className="flex items-center gap-3">
									<div className="flex items-center gap-2">
										<Dot color={vaultConnected ? 'success' : 'danger'} pulse={vaultConnected} />
										<div>
											<span className="text-sm font-medium text-text">
												Vault: {vaultConnected ? 'Connected' : 'Disconnected'}
											</span>
											<p className="text-[11px] text-text-dim mt-0.5">
												Stores encrypted key shares
											</p>
										</div>
									</div>
									<div className="flex items-center gap-2">
										<Dot color={dbConnected ? 'success' : 'danger'} pulse={dbConnected} />
										<div>
											<span className="text-sm font-medium text-text">
												Database: {dbConnected ? 'Connected' : 'Disconnected'}
											</span>
											<p className="text-[11px] text-text-dim mt-0.5">
												Account records and audit log
											</p>
										</div>
									</div>
								</div>
								<Separator />
								<div className="grid grid-cols-2 gap-4 text-sm">
									<div>
										<span className="text-text-dim">Server Status</span>
										<p className="font-mono text-text mt-0.5">{health?.status ?? '--'}</p>
									</div>
									<div>
										<span className="text-text-dim">Server Uptime</span>
										<p className="font-mono text-text mt-0.5">{formatUptime(serverUptime)}</p>
									</div>
								</div>
							</>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-base">Supported Networks</CardTitle>
						<CardDescription>Each account is bound to a specific chain at creation</CardDescription>
					</CardHeader>
					<CardContent>
						{networksLoading ? (
							<div className="flex items-center gap-2 text-sm text-text-muted">
								<Loader2 className="h-4 w-4 animate-spin" />
								Loading networks...
							</div>
						) : networks && networks.length > 0 ? (
							<div className="space-y-3">
								{networks.map((n, i) => (
									<div
										key={n.id}
										className="flex items-center justify-between text-sm animate-stagger-in"
										style={{ '--stagger': i } as React.CSSProperties}
									>
										<div className="flex items-center gap-2">
											<Dot color={n.enabled ? 'success' : 'warning'} />
											<span className="font-medium text-text">{n.displayName}</span>
											{n.isTestnet && <Pill color="default">testnet</Pill>}
										</div>
										<Mono size="xs" className="text-text-dim">
											Chain {n.chainId}
										</Mono>
									</div>
								))}
							</div>
						) : (
							<p className="text-[13px] text-text-muted">
								No networks configured. Check your server's chain registry.
							</p>
						)}
					</CardContent>
				</Card>
			</div>
		</>
	);
}
