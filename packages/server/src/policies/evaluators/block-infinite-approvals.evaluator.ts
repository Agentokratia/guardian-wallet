import type { BlockInfiniteApprovalsCriterion, PolicyContext } from '@agentokratia/guardian-core';
import { type Hex, decodeAbiParameters, parseAbiParameters } from 'viem';
import { EFFECTIVELY_UNLIMITED } from './helpers.js';
import type { CriterionEvaluator } from './types.js';

// ERC-20 approve(address,uint256)          — 0x095ea7b3
// ERC-20 increaseAllowance(address,uint256) — 0x39509351 (OpenZeppelin)
const APPROVE_ABI_PARAMS = parseAbiParameters('address spender, uint256 amount');

// Permit2 approve(address,address,uint160,uint48) — 0x87517c45
const PERMIT2_APPROVE_PARAMS = parseAbiParameters(
	'address token, address spender, uint160 amount, uint48 expiration',
);

// ERC-721/1155 setApprovalForAll(address,bool) — 0xa22cb465
const SET_APPROVAL_FOR_ALL_PARAMS = parseAbiParameters('address operator, bool approved');

/** Selectors that grant token spending rights. */
const APPROVAL_SELECTORS: Record<string, 'erc20' | 'permit2' | 'approvalForAll'> = {
	'0x095ea7b3': 'erc20', // approve(address,uint256)
	'0x39509351': 'erc20', // increaseAllowance(address,uint256)
	'0x87517c45': 'permit2', // Permit2 approve(address,uint160,uint48,uint48)
	'0xa22cb465': 'approvalForAll', // setApprovalForAll(address,bool)
};

export const blockInfiniteApprovalsEvaluator: CriterionEvaluator<BlockInfiniteApprovalsCriterion> =
	{
		type: 'blockInfiniteApprovals',
		evaluate(c, ctx) {
			if (!c.enabled) return true;
			if (!ctx.txData) return true;

			const selector = ctx.txData.slice(0, 10).toLowerCase();
			const approvalType = APPROVAL_SELECTORS[selector];
			if (!approvalType) return true; // not an approval call

			try {
				const params = `0x${ctx.txData.slice(10)}` as Hex;

				if (approvalType === 'erc20') {
					const [, amount] = decodeAbiParameters(APPROVE_ABI_PARAMS, params);
					return amount < EFFECTIVELY_UNLIMITED;
				}

				if (approvalType === 'permit2') {
					// Permit2 uses uint160 — same EFFECTIVELY_UNLIMITED threshold as ERC-20
					const [, , amount] = decodeAbiParameters(PERMIT2_APPROVE_PARAMS, params);
					return amount < EFFECTIVELY_UNLIMITED;
				}

				if (approvalType === 'approvalForAll') {
					// setApprovalForAll(operator, true) grants blanket access — always block
					const [, approved] = decodeAbiParameters(SET_APPROVAL_FOR_ALL_PARAMS, params);
					return !approved; // approved=true → block (return false)
				}

				return true;
			} catch {
				return false; // can't parse approval calldata → fail-closed (block)
			}
		},
		failReason() {
			return {
				short: 'Unlimited approval blocked',
				detail: 'Unlimited token approval detected — only finite approvals allowed',
			};
		},
	};
