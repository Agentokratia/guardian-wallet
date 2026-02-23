import type { Criterion, PolicyRule } from '@agentokratia/guardian-core';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { getAddress, isAddress } from 'viem';
import { PolicyDocumentRepository } from './policy-document.repository.js';
import type { PolicyDocumentEntity } from './policy-document.types.js';

const VALID_COMPARISON_OPS = new Set(['<=', '<', '>=', '>', '=']);
const VALID_SET_OPS = new Set(['in', 'not_in']);
const VALID_ACTIONS = new Set(['accept', 'reject']);
const SELECTOR_RE = /^0x[0-9a-fA-F]{8}$/;
const WEI_RE = /^\d+$/;
const MAX_HOUR = 23;
const MAX_SLIPPAGE = 100;

// ─── Per-type validators ─────────────────────────────────────────────────────

type CriterionValidator = (c: Criterion, prefix: string) => void;

function requireSetOp(c: Criterion, prefix: string): void {
	if (!VALID_SET_OPS.has((c as { operator: string }).operator)) {
		throw new BadRequestException(
			`${prefix}: invalid operator "${(c as { operator: string }).operator}"`,
		);
	}
}

function validateWei(value: string, prefix: string): void {
	if (typeof value !== 'string' || !WEI_RE.test(value)) {
		throw new BadRequestException(
			`${prefix}: wei value must be a non-negative integer string, got "${value}"`,
		);
	}
}

function requireBoolean(field: unknown, fieldName: string, prefix: string): void {
	if (typeof field !== 'boolean') {
		throw new BadRequestException(`${prefix}: ${fieldName} must be a boolean`);
	}
}

function requireUsd(c: Criterion, prefix: string): void {
	const maxUsd = (c as { maxUsd: unknown }).maxUsd;
	if (typeof maxUsd !== 'number' || !Number.isFinite(maxUsd) || maxUsd < 0) {
		throw new BadRequestException(`${prefix}: maxUsd must be a finite non-negative number`);
	}
}

const VALIDATORS: Record<string, CriterionValidator> = {
	ethValue(c, prefix) {
		if (!VALID_COMPARISON_OPS.has((c as { operator: string }).operator)) {
			throw new BadRequestException(
				`${prefix}: invalid operator "${(c as { operator: string }).operator}"`,
			);
		}
		validateWei((c as { value: string }).value, prefix);
	},

	evmAddress(c, prefix) {
		requireSetOp(c, prefix);
		const addrs = (c as { addresses: unknown }).addresses;
		if (!Array.isArray(addrs)) {
			throw new BadRequestException(`${prefix}: addresses must be an array`);
		}
		// Accept loose hex, normalize to EIP-55 checksum for storage
		for (let i = 0; i < addrs.length; i++) {
			if (!isAddress(addrs[i], { strict: false })) {
				throw new BadRequestException(`${prefix}: invalid address "${addrs[i]}"`);
			}
			addrs[i] = getAddress(addrs[i]);
		}
	},

	evmNetwork(c, prefix) {
		requireSetOp(c, prefix);
		const { chainIds } = c as { chainIds: unknown };
		if (!Array.isArray(chainIds) || chainIds.some((id: unknown) => typeof id !== 'number')) {
			throw new BadRequestException(`${prefix}: chainIds must be a number array`);
		}
	},

	evmFunction(c, prefix) {
		const { selectors } = c as { selectors: unknown };
		if (!Array.isArray(selectors)) {
			throw new BadRequestException(`${prefix}: selectors must be an array`);
		}
		for (const sel of selectors) {
			if (!SELECTOR_RE.test(sel)) {
				throw new BadRequestException(`${prefix}: invalid selector "${sel}"`);
			}
		}
	},

	ipAddress(c, prefix) {
		requireSetOp(c, prefix);
		const { ips } = c as { ips: unknown };
		if (!Array.isArray(ips)) {
			throw new BadRequestException(`${prefix}: ips must be an array`);
		}
	},

	rateLimit(c, prefix) {
		const { maxPerHour } = c as { maxPerHour: unknown };
		if (typeof maxPerHour !== 'number' || !Number.isInteger(maxPerHour) || maxPerHour <= 0) {
			throw new BadRequestException(`${prefix}: maxPerHour must be a positive integer`);
		}
	},

	timeWindow(c, prefix) {
		const { startHour, endHour } = c as { startHour: unknown; endHour: unknown };
		if (typeof startHour !== 'number' || typeof endHour !== 'number') {
			throw new BadRequestException(`${prefix}: startHour/endHour must be numbers`);
		}
		if (startHour < 0 || startHour > MAX_HOUR || endHour < 0 || endHour > MAX_HOUR) {
			throw new BadRequestException(`${prefix}: hours must be 0-${MAX_HOUR}`);
		}
	},

	dailyLimit(c, prefix) {
		validateWei((c as { maxWei: string }).maxWei, prefix);
	},

	monthlyLimit(c, prefix) {
		validateWei((c as { maxWei: string }).maxWei, prefix);
	},

	maxPerTxUsd: requireUsd,
	dailyLimitUsd: requireUsd,
	monthlyLimitUsd: requireUsd,

	blockInfiniteApprovals(c, prefix) {
		requireBoolean((c as { enabled: unknown }).enabled, 'enabled', prefix);
	},

	maxSlippage(c, prefix) {
		const { maxPercent } = c as { maxPercent: unknown };
		if (
			typeof maxPercent !== 'number' ||
			!Number.isFinite(maxPercent) ||
			maxPercent < 0 ||
			maxPercent > MAX_SLIPPAGE
		) {
			throw new BadRequestException(
				`${prefix}: maxPercent must be a finite number 0-${MAX_SLIPPAGE}`,
			);
		}
	},

	mevProtection(c, prefix) {
		requireBoolean((c as { enabled: unknown }).enabled, 'enabled', prefix);
	},
};

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class PolicyDocumentService {
	constructor(@Inject(PolicyDocumentRepository) private readonly repo: PolicyDocumentRepository) {}

	async get(signerId: string): Promise<PolicyDocumentEntity | null> {
		return this.repo.findBySigner(signerId);
	}

	async getDraft(signerId: string): Promise<PolicyDocumentEntity | null> {
		return this.repo.findDraftBySigner(signerId);
	}

	async save(
		signerId: string,
		rules: readonly PolicyRule[],
		description?: string,
	): Promise<PolicyDocumentEntity> {
		this.validateRules(rules);
		return this.repo.upsert(signerId, rules, description);
	}

	async saveDraft(
		signerId: string,
		rules: readonly PolicyRule[],
		description?: string,
	): Promise<PolicyDocumentEntity> {
		this.validateRules(rules);
		return this.repo.saveDraft(signerId, rules, description);
	}

	async activate(signerId: string): Promise<PolicyDocumentEntity> {
		return this.repo.activate(signerId);
	}

	validateRules(rules: readonly PolicyRule[]): void {
		for (let i = 0; i < rules.length; i++) {
			const rule = rules[i];
			if (!rule || !VALID_ACTIONS.has(rule.action)) {
				throw new BadRequestException(`Rule ${i}: invalid action "${rule?.action}"`);
			}
			if (
				!Array.isArray(rule.criteria) ||
				(rule.criteria.length === 0 && rule.action !== 'reject')
			) {
				throw new BadRequestException(`Rule ${i}: must have at least one criterion`);
			}
			for (let j = 0; j < rule.criteria.length; j++) {
				const criterion = rule.criteria[j];
				if (criterion) this.validateCriterion(criterion, i, j);
			}
		}
	}

	private validateCriterion(c: Criterion, ruleIdx: number, critIdx: number): void {
		const prefix = `Rule ${ruleIdx}, criterion ${critIdx}`;
		const validator = VALIDATORS[c.type];
		if (!validator) {
			throw new BadRequestException(`${prefix}: unknown type "${c.type}"`);
		}
		validator(c, prefix);
	}
}
