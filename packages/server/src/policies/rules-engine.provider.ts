/**
 * Rules engine — ordered rules, first-match-wins, default deny.
 *
 * Each signer has a single PolicyDocument containing ordered rules.
 * Each rule has an action (accept/reject) and composable criteria (AND'd).
 * Rules evaluated top-down, first rule where ALL criteria match → use its action.
 * No match → default deny, with diagnostic info about which criteria failed.
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
import { evaluateCriterion } from './criteria-evaluators.js';

// ─── Human-readable reasons per criterion type ─────────────────────────────

interface FailReason {
	/** Safe to return to any caller (no thresholds, addresses, or config details). */
	short: string;
	/** Full diagnostic — for dashboard/audit only (includes exact values + limits). */
	detail: string;
}

function criterionFailReason(c: Criterion, ctx: PolicyContext): FailReason {
	switch (c.type) {
		case 'evmAddress':
			if (c.operator === 'not_in') {
				return {
					short: 'Blocked address',
					detail: `Transaction to blocked address ${ctx.toAddress ?? 'unknown'}`,
				};
			}
			return {
				short: 'Address not approved',
				detail: `Address ${ctx.toAddress ?? 'unknown'} is not in the approved list`,
			};

		case 'evmNetwork':
			return {
				short: 'Network not allowed',
				detail:
					c.operator === 'in'
						? `Chain ${ctx.chainId} is not in the allowed networks`
						: `Chain ${ctx.chainId} is blocked`,
			};

		case 'maxPerTxUsd':
			return {
				short: 'Per-transaction limit exceeded',
				detail:
					ctx.valueUsd === undefined
						? 'Unable to determine USD value — price data unavailable (fail-closed)'
						: `Transaction value $${ctx.valueUsd.toFixed(2)} exceeds per-transaction limit of $${c.maxUsd.toLocaleString()}`,
			};

		case 'dailyLimitUsd':
			return {
				short: 'Daily spending limit exceeded',
				detail:
					ctx.valueUsd === undefined || ctx.rollingDailySpendUsd === undefined
						? 'Unable to verify daily spend — price data unavailable (fail-closed)'
						: `Daily spend $${(ctx.rollingDailySpendUsd + ctx.valueUsd).toFixed(2)} would exceed daily limit of $${c.maxUsd.toLocaleString()}`,
			};

		case 'monthlyLimitUsd':
			return {
				short: 'Monthly spending limit exceeded',
				detail:
					ctx.valueUsd === undefined || ctx.rollingMonthlySpendUsd === undefined
						? 'Unable to verify monthly spend — price data unavailable (fail-closed)'
						: `Monthly spend $${(ctx.rollingMonthlySpendUsd + ctx.valueUsd).toFixed(2)} would exceed monthly limit of $${c.maxUsd.toLocaleString()}`,
			};

		case 'rateLimit':
			return {
				short: 'Rate limit exceeded',
				detail: `Rate limit exceeded: ${ctx.requestCountLastHour}/${c.maxPerHour} requests this hour`,
			};

		case 'timeWindow':
			return {
				short: 'Outside trading hours',
				detail: `Current hour ${ctx.currentHourUtc} UTC is outside trading window ${c.startHour}:00–${c.endHour}:00`,
			};

		case 'ethValue':
			return { short: 'ETH value limit exceeded', detail: 'Transaction value exceeds ETH limit' };

		case 'dailyLimit':
			return {
				short: 'Daily ETH limit exceeded',
				detail: 'Rolling 24h spend exceeds daily ETH limit',
			};

		case 'monthlyLimit':
			return {
				short: 'Monthly ETH limit exceeded',
				detail: 'Rolling 30d spend exceeds monthly ETH limit',
			};

		case 'blockInfiniteApprovals':
			return {
				short: 'Unlimited approval blocked',
				detail: 'Unlimited token approval detected — only finite approvals allowed',
			};

		case 'evmFunction':
			return {
				short: 'Function not allowed',
				detail: `Function ${ctx.functionSelector ?? 'unknown'} is not in the allowed list`,
			};

		case 'ipAddress':
			return {
				short: 'IP not allowed',
				detail: `IP ${ctx.callerIp ?? 'unknown'} is not allowed`,
			};

		default:
			return {
				short: 'Policy check failed',
				detail: `Criterion ${(c as Criterion).type} not satisfied`,
			};
	}
}

@Injectable()
export class RulesEngineProvider implements IRulesEngine {
	private readonly logger = new Logger(RulesEngineProvider.name);

	async evaluate(document: PolicyDocument | null, context: PolicyContext): Promise<PolicyResult> {
		const start = performance.now();

		// No document → unconfigured signer → default deny
		if (!document) {
			const evaluationTimeMs = Math.round(performance.now() - start);
			return {
				allowed: false,
				violations: [
					{
						policyId: 'none',
						type: PolicyType.DEFAULT_DENY,
						reason: 'No policy configured — default deny',
						config: {},
					},
				],
				evaluatedCount: 0,
				evaluationTimeMs,
			};
		}

		// Document with empty rules → user explicitly chose no restrictions → allow all
		if (document.rules.length === 0) {
			const evaluationTimeMs = Math.round(performance.now() - start);
			return {
				allowed: true,
				violations: [],
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
