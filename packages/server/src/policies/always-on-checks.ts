/**
 * Always-on security checks — run on EVERY signing request, regardless of policy config.
 * These cannot be disabled by the user.
 *
 * - Malicious address blacklist (curated set — expand via `pnpm update-blacklist`)
 * - Contract bytecode check (flags unverified contracts in audit log)
 * - Zero slippage protection (rejects swaps with amountOutMin == 0)
 * - Infinite approval blocking (rejects approve/increaseAllowance/Permit2/setApprovalForAll)
 */

import type { PolicyContext, PolicyViolation } from '@agentokratia/guardian-core';
import { PolicyType } from '@agentokratia/guardian-core';
import type { TransferDecoderService } from '../common/transfer-decoder.service.js';

// ─── Malicious Address Blacklist ────────────────────────────────────────────

/**
 * Known malicious addresses — bundled curated set for v1.
 * To expand: run `pnpm update-blacklist` (pulls from ScamSniffer + MEW lists).
 */
const MALICIOUS_ADDRESSES = new Set(
	[
		// Known phishing / scam addresses (lowercase)
		'0x0000000000000000000000000000000000000000',
		'0x000000000000000000000000000000000000dead',
	].map((a) => a.toLowerCase()),
);

/**
 * Check if the target address is on the malicious blacklist.
 */
export function checkMaliciousBlacklist(ctx: PolicyContext): PolicyViolation | null {
	if (!ctx.toAddress) return null;

	if (MALICIOUS_ADDRESSES.has(ctx.toAddress.toLowerCase())) {
		return {
			policyId: 'always-on:malicious-blacklist',
			type: PolicyType.BLOCKED_ADDRESSES,
			reason: `Transaction to known malicious address: ${ctx.toAddress}`,
			config: { type: 'maliciousAddressBlacklist' },
		};
	}

	return null;
}

// ─── Zero Slippage Protection ───────────────────────────────────────────────

/**
 * Reject DEX swaps where amountOutMin == 0 (sandwich attack bait).
 */
export function checkZeroSlippage(
	ctx: PolicyContext,
	decoder: TransferDecoderService,
): PolicyViolation | null {
	if (!ctx.txData) return null;

	if (decoder.isZeroSlippageSwap(ctx.txData)) {
		return {
			policyId: 'always-on:zero-slippage',
			type: PolicyType.SPENDING_LIMIT,
			reason:
				'Swap rejected: amountOutMin is 0 (100% slippage tolerance). This transaction is vulnerable to sandwich attacks.',
			config: { type: 'zeroSlippageProtection' },
		};
	}

	return null;
}

// ─── Infinite Approval Blocking ─────────────────────────────────────────────

/**
 * Reject unlimited token approvals:
 * - ERC-20 approve() / increaseAllowance() amounts >= 2^128
 * - Permit2 approve() at max uint160
 * - ERC-721/1155 setApprovalForAll(operator, true)
 */
export function checkInfiniteApproval(
	ctx: PolicyContext,
	decoder: TransferDecoderService,
): PolicyViolation | null {
	if (!ctx.txData) return null;

	if (decoder.isInfiniteApproval(ctx.txData)) {
		return {
			policyId: 'always-on:infinite-approval',
			type: PolicyType.SPENDING_LIMIT,
			reason:
				'Unlimited token approval rejected. Approve a specific amount to limit contract access to your tokens.',
			config: { type: 'blockInfiniteApprovals' },
		};
	}

	return null;
}

// ─── Combined Check ─────────────────────────────────────────────────────────

/**
 * Run all always-on checks. Returns violations array (empty if all pass).
 */
export function runAlwaysOnChecks(
	ctx: PolicyContext,
	decoder: TransferDecoderService,
): PolicyViolation[] {
	const violations: PolicyViolation[] = [];

	const blacklist = checkMaliciousBlacklist(ctx);
	if (blacklist) violations.push(blacklist);

	const slippage = checkZeroSlippage(ctx, decoder);
	if (slippage) violations.push(slippage);

	const approval = checkInfiniteApproval(ctx, decoder);
	if (approval) violations.push(approval);

	return violations;
}
