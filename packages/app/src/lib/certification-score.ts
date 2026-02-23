import type { PolicyDocumentResponse, Signer, SigningRequest } from './types';

/* ========================================================================== */
/*  Types                                                                      */
/* ========================================================================== */

export type CertificationTier = 'certified' | 'verified' | 'provisional' | 'uncertified';

export interface PolicyPostureBreakdown {
	networkControl: number;
	contractControl: number;
	spendingLimits: number;
	rateControls: number;
	defiSafety: number;
	advanced: number;
	total: number;
	max: number;
}

export interface ComplianceBreakdown {
	totalRequests: number;
	approved: number;
	blocked: number;
	safeRate: number;
	score: number;
	max: number;
}

export interface MaturityBreakdown {
	ageDays: number;
	ageScore: number;
	volume: number;
	volumeScore: number;
	lastActiveHoursAgo: number | null;
	recencyScore: number;
	total: number;
	max: number;
}

export interface CertificationScore {
	score: number;
	tier: CertificationTier;
	tierLabel: string;
	tierDescription: string;
	policyPosture: PolicyPostureBreakdown;
	compliance: ComplianceBreakdown;
	maturity: MaturityBreakdown;
	activeGuardrails: number;
}

/* ========================================================================== */
/*  Tier resolution                                                            */
/* ========================================================================== */

export function getTier(score: number): CertificationTier {
	if (score >= 90) return 'certified';
	if (score >= 70) return 'verified';
	if (score >= 40) return 'provisional';
	return 'uncertified';
}

const TIER_META: Record<CertificationTier, { label: string; description: string }> = {
	certified: {
		label: 'Certified',
		description: 'Fully protected. All recommended guardrails are active.',
	},
	verified: {
		label: 'Verified',
		description: 'Well protected. Most critical guardrails are enabled.',
	},
	provisional: {
		label: 'Provisional',
		description: 'Partially protected. More guardrails recommended.',
	},
	uncertified: {
		label: 'Unprotected',
		description: 'Missing critical guardrails. Add protections to secure this account.',
	},
};

export function getTierLabel(tier: CertificationTier): string {
	return TIER_META[tier].label;
}

export function getTierDescription(tier: CertificationTier): string {
	return TIER_META[tier].description;
}

export const TIER_COLORS: Record<
	CertificationTier,
	{ text: string; bg: string; border: string; dot: string; accent: string; ring: string }
> = {
	certified: {
		text: 'text-accent',
		bg: 'bg-accent-muted',
		border: 'border-accent/20',
		dot: 'bg-accent',
		accent: '#1A1A1A',
		ring: 'stroke-accent',
	},
	verified: {
		text: 'text-[#15803D]',
		bg: 'bg-success-muted',
		border: 'border-success/20',
		dot: 'bg-success',
		accent: '#15803D',
		ring: 'stroke-success',
	},
	provisional: {
		text: 'text-[#B45309]',
		bg: 'bg-warning-muted',
		border: 'border-warning/20',
		dot: 'bg-warning',
		accent: '#B45309',
		ring: 'stroke-warning',
	},
	uncertified: {
		text: 'text-text-muted',
		bg: 'bg-text-dim/10',
		border: 'border-border',
		dot: 'bg-text-dim',
		accent: '#6B6B6B',
		ring: 'stroke-text-dim',
	},
};

/* ========================================================================== */
/*  Policy Posture (0–45 pts)                                                  */
/*  "What guardrails are actually protecting this agent?"                      */
/* ========================================================================== */

function computePolicyPosture(policy: PolicyDocumentResponse | null): PolicyPostureBreakdown {
	const scores = {
		networkControl: 0,
		contractControl: 0,
		spendingLimits: 0,
		rateControls: 0,
		defiSafety: 0,
		advanced: 0,
	};

	if (!policy?.rules) {
		return { ...scores, total: 0, max: 45 };
	}

	const active = new Set<string>();
	let hasWhitelist = false;
	let hasBlocklist = false;

	for (const rule of policy.rules) {
		const r = rule as { criteria?: { type: string; operator?: string }[]; enabled?: boolean };
		if (r.enabled === false) continue;
		for (const c of r.criteria ?? []) {
			active.add(c.type);
			// evmAddressBlocked is stored as { type: 'evmAddress', operator: 'not_in' }
			if (c.type === 'evmAddress') {
				if (c.operator === 'not_in') hasBlocklist = true;
				else hasWhitelist = true;
			}
		}
	}

	// Network (max 4)
	if (active.has('evmNetwork')) scores.networkControl = 4;

	// Contracts (max 11)
	if (hasWhitelist) scores.contractControl += 8;
	if (hasBlocklist) scores.contractControl += 3;

	// Spending limits (max 14)
	// ethValue and maxPerTxUsd both cap per-tx value — credit the same 5 pts for either
	if (active.has('maxPerTxUsd') || active.has('ethValue')) scores.spendingLimits += 5;
	if (active.has('dailyLimitUsd')) scores.spendingLimits += 5;
	if (active.has('monthlyLimitUsd')) scores.spendingLimits += 4;

	// Rate (max 6)
	if (active.has('rateLimit')) scores.rateControls += 4;
	if (active.has('timeWindow')) scores.rateControls += 2;

	// DeFi (max 7)
	if (active.has('blockInfiniteApprovals')) scores.defiSafety += 4;
	if (active.has('maxSlippage')) scores.defiSafety += 3;

	// Advanced (max 3)
	if (active.has('evmFunction')) scores.advanced += 2;
	if (active.has('ipAddress')) scores.advanced += 1;

	const total = Object.values(scores).reduce((s, v) => s + v, 0);
	return { ...scores, total, max: 45 };
}

/* ========================================================================== */
/*  Compliance Record (0–35 pts)                                               */
/*  "How clean is this agent's transaction history?"                           */
/* ========================================================================== */

function computeCompliance(requests: SigningRequest[]): ComplianceBreakdown {
	const approved = requests.filter(
		(r) => r.status === 'approved' || r.status === 'broadcast' || r.status === 'completed',
	).length;
	const blocked = requests.filter((r) => r.status === 'blocked').length;
	const total = requests.length;

	if (total === 0) {
		return { totalRequests: 0, approved: 0, blocked: 0, safeRate: 100, score: 18, max: 35 };
	}

	const safeRate = (approved / total) * 100;

	let score: number;
	if (safeRate >= 99) score = 35;
	else if (safeRate >= 97) score = 30;
	else if (safeRate >= 95) score = 25;
	else if (safeRate >= 90) score = 20;
	else if (safeRate >= 80) score = 15;
	else score = 8;

	return {
		totalRequests: total,
		approved,
		blocked,
		safeRate: Math.round(safeRate * 10) / 10,
		score,
		max: 35,
	};
}

/* ========================================================================== */
/*  Operational Maturity (0–20 pts)                                            */
/*  "How battle-tested is this agent?"                                         */
/* ========================================================================== */

function computeMaturity(signer: Signer, totalRequests: number): MaturityBreakdown {
	const now = Date.now();

	const ageDays = Math.floor((now - new Date(signer.createdAt).getTime()) / 86_400_000);
	const ageScore = Math.min(8, Math.floor(ageDays / 7));

	const volumeScore = Math.min(8, Math.floor(totalRequests / 25));

	let lastActiveHoursAgo: number | null = null;
	let recencyScore = 0;

	if (signer.lastActiveAt) {
		lastActiveHoursAgo = Math.floor((now - new Date(signer.lastActiveAt).getTime()) / 3_600_000);
		if (lastActiveHoursAgo <= 24) recencyScore = 4;
		else if (lastActiveHoursAgo <= 72) recencyScore = 3;
		else if (lastActiveHoursAgo <= 168) recencyScore = 2;
		else if (lastActiveHoursAgo <= 720) recencyScore = 1;
	}

	return {
		ageDays,
		ageScore,
		volume: totalRequests,
		volumeScore,
		lastActiveHoursAgo,
		recencyScore,
		total: ageScore + volumeScore + recencyScore,
		max: 20,
	};
}

/* ========================================================================== */
/*  Main calculation                                                           */
/* ========================================================================== */

export function calculateCertification(
	signer: Signer,
	policy: PolicyDocumentResponse | null,
	requests: SigningRequest[],
): CertificationScore {
	const policyPosture = computePolicyPosture(policy);
	const compliance = computeCompliance(requests);
	const maturity = computeMaturity(signer, requests.length);

	const score = Math.min(100, policyPosture.total + compliance.score + maturity.total);
	const tier = getTier(score);

	let activeGuardrails = 0;
	if (policy?.rules) {
		for (const rule of policy.rules) {
			const r = rule as { criteria?: unknown[]; enabled?: boolean };
			if (r.enabled !== false) {
				activeGuardrails += r.criteria?.length ?? 0;
			}
		}
	}

	return {
		score,
		tier,
		tierLabel: getTierLabel(tier),
		tierDescription: getTierDescription(tier),
		policyPosture,
		compliance,
		maturity,
		activeGuardrails,
	};
}
