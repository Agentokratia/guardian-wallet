/**
 * Policy backtest service — re-evaluates a draft policy against recent signing requests.
 *
 * "This policy would have blocked N of your last 20 transactions."
 * Gives traders confidence before activating a new policy.
 */

import type { PolicyContext, PolicyResult, PolicyRule } from '@agentokratia/guardian-core';
import { RequestStatus } from '@agentokratia/guardian-core';
import { Inject, Injectable } from '@nestjs/common';
import { SigningRequestRepository } from '../audit/signing-request.repository.js';
import type { SigningRequestEntity } from '../audit/signing-request.types.js';
import { RulesEngineProvider } from './rules-engine.provider.js';

export interface BacktestResult {
	readonly totalAnalyzed: number;
	readonly wouldPass: number;
	readonly wouldBlock: number;
	readonly blockedRequests: readonly BacktestBlockedRequest[];
}

export interface BacktestBlockedRequest {
	readonly requestId: string;
	readonly toAddress: string | null;
	readonly valueWei: string | null;
	readonly valueUsd: number | null;
	readonly decodedAction: string | null;
	readonly createdAt: string;
	readonly reasons: readonly string[];
}

@Injectable()
export class PolicyBacktestService {
	constructor(
		@Inject(SigningRequestRepository) private readonly signingRequestRepo: SigningRequestRepository,
		@Inject('RULES_ENGINE')
		private readonly rulesEngine: {
			evaluate: (
				doc: { rules: readonly PolicyRule[] } | null,
				ctx: PolicyContext,
			) => Promise<PolicyResult>;
		},
	) {}

	/**
	 * Re-evaluate draft rules against the last N approved signing requests.
	 */
	async backtest(
		signerId: string,
		draftRules: readonly PolicyRule[],
		limit = 20,
	): Promise<BacktestResult> {
		// Get recent approved requests
		const { data: requests } = await this.signingRequestRepo.findAll(
			{ signerId, status: RequestStatus.APPROVED },
			{ page: 1, limit },
		);

		const blocked: BacktestBlockedRequest[] = [];

		for (const req of requests) {
			const ctx = this.requestToContext(req);
			const result = await this.rulesEngine.evaluate({ rules: draftRules }, ctx);

			if (!result.allowed) {
				blocked.push({
					requestId: req.id,
					toAddress: req.toAddress,
					valueWei: req.valueWei,
					valueUsd: req.valueUsd,
					decodedAction: req.decodedAction,
					createdAt: req.createdAt.toISOString(),
					reasons: result.violations.map((v) => v.reason),
				});
			}
		}

		return {
			totalAnalyzed: requests.length,
			wouldPass: requests.length - blocked.length,
			wouldBlock: blocked.length,
			blockedRequests: blocked,
		};
	}

	private requestToContext(req: SigningRequestEntity): PolicyContext {
		return {
			signerAddress: '',
			toAddress: req.toAddress ?? undefined,
			valueWei: req.valueWei ? BigInt(req.valueWei) : 0n,
			chainId: req.chainId ?? 1,
			rollingDailySpendWei: 0n,
			rollingMonthlySpendWei: 0n,
			requestCountLastHour: 0,
			requestCountToday: 0,
			currentHourUtc: req.createdAt.getUTCHours(),
			timestamp: req.createdAt,
			txData: req.txData ?? undefined,
			valueUsd: req.valueUsd ?? undefined,
			rollingDailySpendUsd: 0,
			rollingMonthlySpendUsd: 0,
		};
	}
}
