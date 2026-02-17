/**
 * Rules engine — ordered rules, first-match-wins, default deny.
 *
 * Each signer has a single PolicyDocument containing ordered rules.
 * Each rule has an action (accept/reject) and composable criteria (AND'd).
 * Rules evaluated top-down, first rule where ALL criteria match → use its action.
 * No match → default deny.
 */

import {
	type IRulesEngine,
	type PolicyContext,
	type PolicyDocument,
	type PolicyResult,
	PolicyType,
	type PolicyViolation,
} from '@agentokratia/guardian-core';
import { Injectable, Logger } from '@nestjs/common';
import { evaluateCriterion } from './criteria-evaluators.js';

@Injectable()
export class RulesEngineProvider implements IRulesEngine {
	private readonly logger = new Logger(RulesEngineProvider.name);

	async evaluate(document: PolicyDocument | null, context: PolicyContext): Promise<PolicyResult> {
		const start = performance.now();

		// No document or no rules → default deny
		if (!document || document.rules.length === 0) {
			const evaluationTimeMs = Math.round(performance.now() - start);
			return {
				allowed: false,
				violations: [
					{
						policyId: document?.id ?? 'none',
						type: PolicyType.DEFAULT_DENY,
						reason: 'No policy rules configured — default deny',
						config: {},
					},
				],
				evaluatedCount: 0,
				evaluationTimeMs,
			};
		}

		let evaluatedCount = 0;

		for (const rule of document.rules) {
			// Skip disabled rules
			if (rule.enabled === false) {
				continue;
			}

			evaluatedCount++;

			// AND all criteria within this rule: all must pass for the rule to match
			let allCriteriaMatch = true;

			for (const criterion of rule.criteria) {
				if (!evaluateCriterion(criterion, context)) {
					allCriteriaMatch = false;
					break;
				}
			}

			if (!allCriteriaMatch) {
				continue;
			}

			// First matching rule wins
			const evaluationTimeMs = Math.round(performance.now() - start);

			if (rule.action === 'accept') {
				return {
					allowed: true,
					violations: [],
					evaluatedCount,
					evaluationTimeMs,
				};
			}

			// rule.action === 'reject'
			return {
				allowed: false,
				violations: [
					{
						policyId: document.id,
						type: PolicyType.RULE_REJECT,
						reason: rule.description ?? 'Rejected by policy rule',
						config: { rule: rule as unknown as Record<string, unknown> },
					},
				],
				evaluatedCount,
				evaluationTimeMs,
			};
		}

		// No rule matched → default deny
		const evaluationTimeMs = Math.round(performance.now() - start);
		return {
			allowed: false,
			violations: [
				{
					policyId: document.id,
					type: PolicyType.DEFAULT_DENY,
					reason: 'No policy rule matched — default deny',
					config: {},
				},
			],
			evaluatedCount,
			evaluationTimeMs,
		};
	}
}
