import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import type { Criterion, PolicyRule } from '@agentokratia/guardian-core';
import { PolicyDocumentRepository } from './policy-document.repository.js';
import type { PolicyDocumentEntity } from './policy-document.types.js';

const VALID_CRITERIA_TYPES = new Set([
	'ethValue',
	'evmAddress',
	'evmNetwork',
	'evmFunction',
	'ipAddress',
	'rateLimit',
	'timeWindow',
	'dailyLimit',
	'monthlyLimit',
]);

const VALID_COMPARISON_OPS = new Set(['<=', '<', '>=', '>', '=']);
const VALID_SET_OPS = new Set(['in', 'not_in']);
const VALID_ACTIONS = new Set(['accept', 'reject']);

@Injectable()
export class PolicyDocumentService {
	constructor(
		@Inject(PolicyDocumentRepository) private readonly repo: PolicyDocumentRepository,
	) {}

	async get(signerId: string): Promise<PolicyDocumentEntity | null> {
		return this.repo.findBySigner(signerId);
	}

	async save(
		signerId: string,
		rules: readonly PolicyRule[],
		description?: string,
	): Promise<PolicyDocumentEntity> {
		this.validateRules(rules);
		return this.repo.upsert(signerId, rules, description);
	}

	private validateRules(rules: readonly PolicyRule[]): void {
		for (let i = 0; i < rules.length; i++) {
			const rule = rules[i]!;
			if (!VALID_ACTIONS.has(rule.action)) {
				throw new BadRequestException(`Rule ${i}: invalid action "${rule.action}"`);
			}
			if (!Array.isArray(rule.criteria) || rule.criteria.length === 0) {
				throw new BadRequestException(`Rule ${i}: must have at least one criterion`);
			}
			for (let j = 0; j < rule.criteria.length; j++) {
				this.validateCriterion(rule.criteria[j]!, i, j);
			}
		}
	}

	private validateCriterion(c: Criterion, ruleIdx: number, critIdx: number): void {
		const prefix = `Rule ${ruleIdx}, criterion ${critIdx}`;

		if (!VALID_CRITERIA_TYPES.has(c.type)) {
			throw new BadRequestException(`${prefix}: unknown type "${c.type}"`);
		}

		switch (c.type) {
			case 'ethValue':
				if (!VALID_COMPARISON_OPS.has(c.operator)) {
					throw new BadRequestException(`${prefix}: invalid operator "${c.operator}"`);
				}
				this.validateWei(c.value, prefix);
				break;

			case 'evmAddress':
				if (!VALID_SET_OPS.has(c.operator)) {
					throw new BadRequestException(`${prefix}: invalid operator "${c.operator}"`);
				}
				if (!Array.isArray(c.addresses)) {
					throw new BadRequestException(`${prefix}: addresses must be an array`);
				}
				for (const addr of c.addresses) {
					if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
						throw new BadRequestException(`${prefix}: invalid address "${addr}"`);
					}
				}
				break;

			case 'evmNetwork':
				if (!VALID_SET_OPS.has(c.operator)) {
					throw new BadRequestException(`${prefix}: invalid operator "${c.operator}"`);
				}
				if (!Array.isArray(c.chainIds) || c.chainIds.some((id) => typeof id !== 'number')) {
					throw new BadRequestException(`${prefix}: chainIds must be a number array`);
				}
				break;

			case 'evmFunction':
				if (!Array.isArray(c.selectors)) {
					throw new BadRequestException(`${prefix}: selectors must be an array`);
				}
				for (const sel of c.selectors) {
					if (!/^0x[0-9a-fA-F]{8}$/.test(sel)) {
						throw new BadRequestException(`${prefix}: invalid selector "${sel}"`);
					}
				}
				break;

			case 'ipAddress':
				if (!VALID_SET_OPS.has(c.operator)) {
					throw new BadRequestException(`${prefix}: invalid operator "${c.operator}"`);
				}
				if (!Array.isArray(c.ips)) {
					throw new BadRequestException(`${prefix}: ips must be an array`);
				}
				break;

			case 'rateLimit':
				if (typeof c.maxPerHour !== 'number' || c.maxPerHour <= 0) {
					throw new BadRequestException(`${prefix}: maxPerHour must be a positive number`);
				}
				break;

			case 'timeWindow':
				if (typeof c.startHour !== 'number' || typeof c.endHour !== 'number') {
					throw new BadRequestException(`${prefix}: startHour/endHour must be numbers`);
				}
				if (c.startHour < 0 || c.startHour > 23 || c.endHour < 0 || c.endHour > 23) {
					throw new BadRequestException(`${prefix}: hours must be 0-23`);
				}
				break;

			case 'dailyLimit':
				this.validateWei(c.maxWei, prefix);
				break;

			case 'monthlyLimit':
				this.validateWei(c.maxWei, prefix);
				break;
		}
	}

	private validateWei(value: string, prefix: string): void {
		if (typeof value !== 'string' || !/^\d+$/.test(value)) {
			throw new BadRequestException(`${prefix}: wei value must be a non-negative integer string, got "${value}"`);
		}
	}
}
