import { Bot, Cpu, Key, TrendingUp, Users, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type Phase = 'input' | 'creating' | 'encrypt' | 'done' | 'error';

/** Intermediate result after DKG — before passkey encryption */
export interface DKGResult {
	signerId: string;
	ethAddress: string;
	apiKey: string;
	shareData: string;
	userShare: string;
}

/** Final result shown on credentials screen */
export interface CreationResult {
	signerId: string;
	ethAddress: string;
	apiKey: string;
	shareData: string;
	backupStored: boolean;
	backupPayload: string;
}

export interface CreationProgress {
	step: number;
	label: string;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

export const PROGRESS_STEPS = ['Creating account...', 'Generating keys...', 'Done'] as const;

export interface AccountType {
	value: string;
	label: string;
	icon: LucideIcon;
	/** One-line explanation of who this is for */
	subtitle: string;
	/** What the auto-configured guardrails will do */
	guardrails: string[];
	/** Concrete tools/frameworks this is commonly used with */
	usedWith?: string;
}

export const ACCOUNT_TYPES: readonly AccountType[] = [
	{
		value: 'ai_agent',
		label: 'AI Agent',
		icon: Bot,
		subtitle: 'Autonomous software that signs transactions on its own.',
		guardrails: [
			'Spending caps per transaction and daily',
			'Rate limiting to catch runaway loops',
			'Slippage and approval protection',
		],
		usedWith: 'LangChain, CrewAI, AutoGPT, Eliza',
	},
	{
		value: 'trading_bot',
		label: 'Trading Bot',
		icon: Cpu,
		subtitle: 'Automated trading on DEXes like Uniswap or 1inch.',
		guardrails: [
			'Trade and daily spend limits',
			'Only known DEX routers whitelisted',
			'Max slippage cap and rate limiting',
		],
		usedWith: 'Custom bots, Hummingbot, Freqtrade',
	},
	{
		value: 'defi_manager',
		label: 'DeFi Manager',
		icon: TrendingUp,
		subtitle: 'Yield farming, lending, and staking across protocols.',
		guardrails: [
			'Aave, Compound, Lido whitelisted',
			'Higher per-tx limits for deposits',
			'Tight slippage protection',
		],
		usedWith: 'Yearn, custom strategies, rebalancing bots',
	},
	{
		value: 'payment_bot',
		label: 'Payment Bot',
		icon: Zap,
		subtitle: 'Sends payments to known recipients at high volume.',
		guardrails: [
			'Whitelist-only recipients',
			'High-throughput rate limits',
			'Daily and monthly caps',
		],
		usedWith: 'Payroll, subscriptions, vendor payments',
	},
	{
		value: 'team_member',
		label: 'Team Member',
		icon: Users,
		subtitle: 'A person on your team who needs signing access.',
		guardrails: [
			'Business-hours restriction',
			'Human-scale rate limits',
			'Daily and monthly spending caps',
		],
		usedWith: 'Dashboard, manual approvals',
	},
	{
		value: 'custom',
		label: 'Custom',
		icon: Key,
		subtitle: 'Full control. Configure every guardrail yourself.',
		guardrails: ['No guardrails pre-configured', 'You decide everything from scratch'],
	},
] as const;
