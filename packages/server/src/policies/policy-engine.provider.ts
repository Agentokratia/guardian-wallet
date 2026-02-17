import {
	type IPolicyEngine,
	type PolicyContext,
	type PolicyResult,
	PolicyType,
	type PolicyViolation,
} from '@agentokratia/guardian-core';
import { Injectable, Logger } from '@nestjs/common';
import {
	evaluateAllowedContracts,
	evaluateAllowedFunctions,
	evaluateBlockedAddresses,
	evaluateDailyLimit,
	evaluateMonthlyLimit,
	evaluateRateLimit,
	evaluateSpendingLimit,
	evaluateTimeWindow,
} from './policy-evaluators.js';

type PolicyEvaluator = (config: Record<string, unknown>, context: PolicyContext) => boolean;

const evaluators = new Map<PolicyType, PolicyEvaluator>([
	[PolicyType.SPENDING_LIMIT, evaluateSpendingLimit],
	[PolicyType.DAILY_LIMIT, evaluateDailyLimit],
	[PolicyType.MONTHLY_LIMIT, evaluateMonthlyLimit],
	[PolicyType.ALLOWED_CONTRACTS, evaluateAllowedContracts],
	[PolicyType.ALLOWED_FUNCTIONS, evaluateAllowedFunctions],
	[PolicyType.BLOCKED_ADDRESSES, evaluateBlockedAddresses],
	[PolicyType.RATE_LIMIT, evaluateRateLimit],
	[PolicyType.TIME_WINDOW, evaluateTimeWindow],
]);

@Injectable()
export class PolicyEngineProvider implements IPolicyEngine {
	private readonly logger = new Logger(PolicyEngineProvider.name);

	async evaluate(
		policies: ReadonlyArray<{
			id: string;
			type: PolicyType;
			config: Record<string, unknown>;
			enabled: boolean;
		}>,
		context: PolicyContext,
	): Promise<PolicyResult> {
		const start = performance.now();
		const violations: PolicyViolation[] = [];
		let evaluatedCount = 0;

		for (const policy of policies) {
			if (!policy.enabled) {
				continue;
			}

			const evaluator = evaluators.get(policy.type);
			if (!evaluator) {
				this.logger.error(`No implementation for policy type: ${policy.type} — failing closed`);
				violations.push({
					policyId: policy.id,
					type: policy.type,
					reason: `Unknown policy type: ${policy.type} — no evaluator registered`,
					config: policy.config,
				});
				evaluatedCount++;
				continue;
			}

			evaluatedCount++;

			try {
				const allowed = evaluator(policy.config, context);
				if (!allowed) {
					violations.push({
						policyId: policy.id,
						type: policy.type,
						reason: this.buildReason(policy.type, policy.config, context),
						config: policy.config,
					});
				}
			} catch (err) {
				this.logger.error(
					`Policy evaluation failed for ${policy.id} (${policy.type}): ${String(err)}`,
				);
				// Fail closed: treat errors as violations
				violations.push({
					policyId: policy.id,
					type: policy.type,
					reason: `Policy evaluation error: ${String(err)}`,
					config: policy.config,
				});
			}
		}

		const evaluationTimeMs = Math.round(performance.now() - start);

		return {
			allowed: violations.length === 0,
			violations,
			evaluatedCount,
			evaluationTimeMs,
		};
	}

	private buildReason(
		type: PolicyType,
		config: Record<string, unknown>,
		context: PolicyContext,
	): string {
		switch (type) {
			case PolicyType.SPENDING_LIMIT:
				return `Transaction value ${context.valueWei} exceeds per-tx limit of ${config.maxWei} wei`;
			case PolicyType.DAILY_LIMIT:
				return `Daily spend would reach ${context.rollingDailySpendWei + context.valueWei} wei, exceeding limit of ${config.maxWei} wei`;
			case PolicyType.MONTHLY_LIMIT:
				return `Monthly spend would reach ${context.rollingMonthlySpendWei + context.valueWei} wei, exceeding limit of ${config.maxWei} wei`;
			case PolicyType.ALLOWED_CONTRACTS:
				return `Address ${context.toAddress ?? '(deploy)'} is not in allowed contracts list`;
			case PolicyType.ALLOWED_FUNCTIONS:
				return `Function selector ${context.functionSelector ?? '(none)'} is not in allowed functions list`;
			case PolicyType.BLOCKED_ADDRESSES:
				return `Address ${context.toAddress} is blocked`;
			case PolicyType.RATE_LIMIT:
				return `Rate limit exceeded: ${context.requestCountLastHour} requests in last hour (max: ${config.maxPerHour})`;
			case PolicyType.TIME_WINDOW:
				return `Current hour ${context.currentHourUtc} UTC is outside allowed window ${config.startHour}-${config.endHour}`;
			default:
				return `Policy ${type} violated`;
		}
	}
}
