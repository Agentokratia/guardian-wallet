import { Bot, Code, Cpu, Globe, Key, Shield, TrendingUp, Zap } from 'lucide-react';

export function getTypeIcon(type: string, className = 'h-5 w-5'): React.ReactNode {
	const icons: Record<string, React.ReactNode> = {
		ai_agent: <Bot className={className} />,
		trading_bot: <Cpu className={className} />,
		defi_manager: <TrendingUp className={className} />,
		payment_bot: <Zap className={className} />,
		team_member: <Shield className={className} />,
		custom: <Key className={className} />,
		// Legacy type IDs for backward compatibility
		deploy_script: <Code className={className} />,
		backend_service: <Globe className={className} />,
		agent: <Bot className={className} />,
		bot: <Cpu className={className} />,
		script: <Code className={className} />,
		service: <Globe className={className} />,
		team: <Shield className={className} />,
		default: <Key className={className} />,
	};
	return icons[type] ?? icons.default;
}

export const statusConfig = {
	active: { dot: 'success' as const, label: 'Active', pill: 'success' as const },
	paused: { dot: 'warning' as const, label: 'Paused', pill: 'warning' as const },
	revoked: { dot: 'danger' as const, label: 'Revoked', pill: 'danger' as const },
} as const;
