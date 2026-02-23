/**
 * Rules engine — ordered rules, first-match-wins.
 *
 * Each signer has a single PolicyDocument containing ordered rules.
 * Each rule has an action (accept/reject) and composable criteria (AND'd).
 * Rules evaluated top-down, first rule where ALL criteria match → use its action.
 * No match → default deny, with diagnostic info about which criteria failed.
 *
 * No policy document (null) → default ALLOW. The 2-of-3 MPC threshold is the
 * primary access control gate; policies are an additional restriction layer.
 */

import {
	type Criterion,
	type IRulesEngine,
	type PolicyContext,
	type PolicyDocument,
	type PolicyResult,
	PolicyType,
} from '@agentokratia/guardian-core';
import { Injectable, Logger } from '@nestjs/common';
import { criterionFailReason, evaluateCriterion } from './evaluators/index.js';
import type { FailReason } from './evaluators/types.js';

@Injectable()
export class RulesEngineProvider implements IRulesEngine {
	private readonly logger = new Logger(RulesEngineProvider.name);

	async evaluate(document: PolicyDocument | null, context: PolicyContext): Promise<PolicyResult> {
		const start = performance.now();

		// No document → unconfigured signer → default allow
		// The 2-of-3 MPC threshold is already the access control gate.
		// Policies are an additional restriction layer, not the primary gate.
		if (!document) {
			const evaluationTimeMs = Math.round(performance.now() - start);
			this.logger.warn('No policy configured — transaction allowed by default');
			return {
				allowed: true,
				violations: [],
				evaluatedCount: 0,
				evaluationTimeMs,
			};
		}

		// Document with empty rules → no rules match → default deny
		if (document.rules.length === 0) {
			const evaluationTimeMs = Math.round(performance.now() - start);
			return {
				allowed: false,
				violations: [
					{
						policyId: document.id,
						type: PolicyType.DEFAULT_DENY,
						reason: 'Policy has no rules configured — default deny',
						config: {},
					},
				],
				evaluatedCount: 0,
				evaluationTimeMs,
			};
		}

		let evaluatedCount = 0;

		// Track the first failing criterion across all accept rules for diagnostics
		let firstFailedCriterion: Criterion | undefined;
		let firstFailedRuleDesc: string | undefined;

		for (const rule of document.rules) {
			// Skip disabled rules
			if (rule.enabled === false) {
				continue;
			}

			evaluatedCount++;

			// AND all criteria within this rule: all must pass for the rule to match
			let allCriteriaMatch = true;

			for (const criterion of rule.criteria) {
				const passed = evaluateCriterion(criterion, context);
				if (!passed) {
					this.logger.debug(
						`Rule "${rule.description ?? rule.action}" failed on criterion: ${criterion.type}`,
					);

					// Track the first failed criterion from accept rules for diagnostics
					if (rule.action === 'accept' && !firstFailedCriterion) {
						firstFailedCriterion = criterion;
						firstFailedRuleDesc = rule.description;
					}

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

		// No rule matched → default deny — but with diagnostic info
		const evaluationTimeMs = Math.round(performance.now() - start);

		const fail = firstFailedCriterion ? criterionFailReason(firstFailedCriterion, context) : null;

		return {
			allowed: false,
			violations: [
				{
					policyId: document.id,
					type: PolicyType.DEFAULT_DENY,
					// detail goes to audit log; short goes to API response (via interactive-sign redaction)
					reason: fail?.detail ?? 'No policy rule matched — default deny',
					config: fail
						? {
								failedCriterion: firstFailedCriterion?.type,
								rule: firstFailedRuleDesc,
								shortReason: fail.short,
							}
						: {},
				},
			],
			evaluatedCount,
			evaluationTimeMs,
		};
	}
}
