import type { EvmAddressCriterion, PolicyContext } from '@agentokratia/guardian-core';
import type { CriterionEvaluator } from './types.js';

export const evmAddressEvaluator: CriterionEvaluator<EvmAddressCriterion> = {
	type: 'evmAddress',
	evaluate(c, ctx) {
		// Empty allowlist → no address restriction configured → pass
		if (c.operator === 'in' && c.addresses.length === 0) return true;

		// Contract deployment (toAddress is undefined/null)
		if (!ctx.toAddress) {
			if (c.operator === 'in') {
				return c.allowDeploy === true;
			}
			// not_in: deploy is allowed unless explicitly blocked (no address to block)
			return true;
		}

		const addresses = c.addresses.map((a) => a.toLowerCase());

		// Check both the tx destination (toAddress) AND the actual fund recipient
		// (transferRecipient). For ERC-20 transfers, toAddress is the token contract
		// while transferRecipient is who actually receives the tokens.
		const addressesToCheck = [ctx.toAddress.toLowerCase()];
		if (ctx.transferRecipient) {
			addressesToCheck.push(ctx.transferRecipient.toLowerCase());
		}

		if (c.operator === 'in') {
			// ALL addresses involved must be in the allowlist
			return addressesToCheck.every((addr) => addresses.includes(addr));
		}
		// not_in: NONE of the addresses involved can be in the blocklist
		return addressesToCheck.every((addr) => !addresses.includes(addr));
	},
	failReason(c, ctx) {
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
	},
};
