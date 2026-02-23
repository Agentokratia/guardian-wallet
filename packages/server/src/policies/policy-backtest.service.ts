/**
 * Policy backtest service — re-evaluates a draft policy against recent signing requests.
 *
 * "This policy would have blocked N of your last 20 transactions."
 * Gives traders confidence before activating a new policy.
 *
 * Limitation: Rolling spend context is approximated from the fetched batch only.
 * The real rolling spend at each historical tx's timestamp is not reconstructed
 * (would require N DB queries per request). Spending limit criteria may show
 * slightly different results than they would have in real-time.
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
		// Get recent approved requests (oldest first for cumulative spend)
		const { data: requests } = await this.signingRequestRepo.findAll(
			{ signerId, status: RequestStatus.APPROVED },
			{ page: 1, limit },
		);

		// Sort oldest-first so cumulative spend builds up chronologically
		const sorted = [...requests].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

		const blocked: BacktestBlockedRequest[] = [];

		// Track cumulative spend across the batch for approximate rolling context
		let cumulativeSpendWei = 0n;
		let cumulativeSpendUsd = 0;
		let requestCount = 0;

		for (const req of sorted) {
			const valueWei = req.valueWei ? BigInt(req.valueWei) : 0n;
			const valueUsd = req.valueUsd ?? 0;

			const ctx = this.requestToContext(req, cumulativeSpendWei, cumulativeSpendUsd, requestCount);
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

			// Accumulate spend for subsequent requests
			cumulativeSpendWei += valueWei;
			cumulativeSpendUsd += valueUsd;
			requestCount++;
		}

		return {
			totalAnalyzed: requests.length,
			wouldPass: requests.length - blocked.length,
			wouldBlock: blocked.length,
			blockedRequests: blocked,
		};
	}

	private requestToContext(
		req: SigningRequestEntity,
		cumulativeSpendWei: bigint,
		cumulativeSpendUsd: number,
		requestCount: number,
	): PolicyContext {
		return {
			signerAddress: '',
			toAddress: req.toAddress ?? undefined,
			valueWei: req.valueWei ? BigInt(req.valueWei) : 0n,
			chainId: req.chainId ?? 1,
			rollingDailySpendWei: cumulativeSpendWei,
			rollingMonthlySpendWei: cumulativeSpendWei,
			requestCountLastHour: requestCount,
			requestCountToday: requestCount,
			currentHourUtc: req.createdAt.getUTCHours(),
			timestamp: req.createdAt,
			txData: req.txData ?? undefined,
			valueUsd: req.valueUsd ?? undefined,
			rollingDailySpendUsd: cumulativeSpendUsd,
			rollingMonthlySpendUsd: cumulativeSpendUsd,
		};
	}
}
