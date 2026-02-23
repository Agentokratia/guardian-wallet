/**
 * Transfer decoder — detects all outgoing value in a transaction.
 *
 * Covers:
 * - Native ETH/MATIC transfers (tx.value)
 * - ERC-20 transfer(to, amount) — selector 0xa9059cbb
 * - ERC-20 transferFrom(from, to, amount) — selector 0x23b872dd
 * - DEX swaps (Uniswap V2/V3, 1inch) — extracts amountIn
 *
 * Uses viem for all ABI decoding and unit formatting.
 */

import { Injectable, Logger } from '@nestjs/common';
import { type Hex, decodeAbiParameters, formatUnits, isAddress, parseAbiParameters } from 'viem';
import type { PriceOracleService } from './price-oracle.service.js';

export interface DecodedOutflow {
	/** 'native' or ERC-20 contract address */
	readonly token: string;
	/** Raw amount in smallest unit (wei/token decimals) */
	readonly amount: bigint;
	/** USD value if price available, undefined otherwise */
	readonly usdValue?: number;
}

export interface TransactionOutflows {
	readonly outflows: readonly DecodedOutflow[];
	/** Total USD value of all outflows (0 if no prices) */
	readonly totalUsd: number;
}

// ─── Selectors ───────────────────────────────────────────────────────────────

const TRANSFER_SELECTOR = '0xa9059cbb';
const TRANSFER_FROM_SELECTOR = '0x23b872dd';
const APPROVE_SELECTOR = '0x095ea7b3';
const INCREASE_ALLOWANCE_SELECTOR = '0x39509351';
const PERMIT2_APPROVE_SELECTOR = '0x87517c45';
const SET_APPROVAL_FOR_ALL_SELECTOR = '0xa22cb465';

const UNISWAP_V2_SWAP_EXACT_TOKENS = '0x38ed1739';
const UNISWAP_V2_SWAP_EXACT_ETH = '0x7ff36ab5';
const UNISWAP_V3_EXACT_INPUT_SINGLE = '0x414bf389';

// ─── Shared constants ────────────────────────────────────────────────────────

/** Any approval above 2^128 is effectively unlimited for any real token supply. */
export const EFFECTIVELY_UNLIMITED = 2n ** 128n;

const ETH_DECIMALS = 18;

// ─── ABI parameter schemas (parsed once, reused) ────────────────────────────

const TRANSFER_PARAMS = parseAbiParameters('address to, uint256 amount');
const TRANSFER_FROM_PARAMS = parseAbiParameters('address from, address to, uint256 amount');
const APPROVE_PARAMS = parseAbiParameters('address spender, uint256 amount');
const PERMIT2_APPROVE_PARAMS = parseAbiParameters(
	'address token, address spender, uint160 amount, uint48 expiration',
);
const SET_APPROVAL_FOR_ALL_PARAMS = parseAbiParameters('address operator, bool approved');
const SWAP_EXACT_TOKENS_PARAMS = parseAbiParameters('uint256 amountIn, uint256 amountOutMin');
const SWAP_EXACT_ETH_PARAMS = parseAbiParameters('uint256 amountOutMin');

/**
 * Known ERC-20 token decimals by chain → lowercase address.
 * Tokens not in this map default to 18 decimals.
 */
const KNOWN_TOKEN_DECIMALS: Record<number, Record<string, number>> = {
	1: {
		'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6, // USDC
		'0xdac17f958d2ee523a2206206994597c13d831ec7': 6, // USDT
		'0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 8, // WBTC
	},
	42161: {
		'0xaf88d065e77c8cc2239327c5edb3a432268e5831': 6, // USDC (native)
		'0xff970a61a04b1ca14834a43f5de4533ebddb5cc8': 6, // USDC.e (bridged)
		'0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 6, // USDT
		'0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': 8, // WBTC
	},
	8453: {
		'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 6, // USDC
	},
	10: {
		'0x0b2c639c533813f4aa9d7837caf62653d097ff85': 6, // USDC (native)
		'0x7f5c764cbc14f9669b88837ca1490cca17c31607': 6, // USDC.e (bridged)
		'0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': 6, // USDT
		'0x68f180fcce6836688e9084f035309e29bf0a2095': 8, // WBTC
	},
	137: {
		'0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': 6, // USDC (native)
		'0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 6, // USDC.e (bridged)
		'0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 6, // USDT
		'0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6': 8, // WBTC
	},
};

@Injectable()
export class TransferDecoderService {
	private readonly logger = new Logger(TransferDecoderService.name);

	/**
	 * Get the number of decimals for a token on a given chain.
	 * Falls back to 18 (standard ERC-20) for unknown tokens.
	 */
	getTokenDecimals(chainId: number, tokenAddress: string): number {
		const chainTokens = KNOWN_TOKEN_DECIMALS[chainId];
		if (!chainTokens) return ETH_DECIMALS;
		return chainTokens[tokenAddress.toLowerCase()] ?? ETH_DECIMALS;
	}

	/**
	 * Decode all outgoing value from a transaction.
	 * Requires priceOracle for USD conversion.
	 */
	async decode(
		tx: {
			value?: bigint;
			data?: string;
			to?: string;
			chainId: number;
		},
		priceOracle: PriceOracleService,
	): Promise<TransactionOutflows> {
		const outflows: DecodedOutflow[] = [];

		// 1. Native value
		if (tx.value && tx.value > 0n) {
			const nativePrice = await priceOracle.getNativePrice(tx.chainId);
			const ethAmount = Number(formatUnits(tx.value, ETH_DECIMALS));
			outflows.push({
				token: 'native',
				amount: tx.value,
				usdValue: nativePrice ? ethAmount * nativePrice : undefined,
			});
		}

		// 2. Calldata-based outflows
		if (tx.data && tx.data.length >= 10) {
			const calldataOutflow = this.decodeCalldata(tx.data as Hex, tx.to);

			if (calldataOutflow) {
				const usdValue = await this.priceOutflow(calldataOutflow, tx.chainId, priceOracle);
				outflows.push({ ...calldataOutflow, usdValue });
			}
		}

		const totalUsd = outflows.reduce((sum, o) => sum + (o.usdValue ?? 0), 0);
		return { outflows, totalUsd };
	}

	/**
	 * Check if calldata grants an effectively unlimited token approval.
	 * Covers:
	 * - ERC-20 approve(address,uint256) — 0x095ea7b3
	 * - ERC-20 increaseAllowance(address,uint256) — 0x39509351
	 * - Permit2 approve(address,uint160,uint48,uint48) — 0x87517c45
	 * - ERC-721/1155 setApprovalForAll(address,bool) — 0xa22cb465
	 */
	isInfiniteApproval(data?: string): boolean {
		if (!data || data.length < 10) return false;
		const selector = data.slice(0, 10).toLowerCase();

		try {
			const params = `0x${data.slice(10)}` as Hex;

			// ERC-20 approve / increaseAllowance — same ABI shape
			if (selector === APPROVE_SELECTOR || selector === INCREASE_ALLOWANCE_SELECTOR) {
				const [, amount] = decodeAbiParameters(APPROVE_PARAMS, params);
				return amount >= EFFECTIVELY_UNLIMITED;
			}

			// Permit2 approve(address token, address spender, uint160 amount, uint48 expiration)
			if (selector === PERMIT2_APPROVE_SELECTOR) {
				const [, , amount] = decodeAbiParameters(PERMIT2_APPROVE_PARAMS, params);
				const PERMIT2_MAX = (1n << 160n) - 1n;
				return amount >= PERMIT2_MAX;
			}

			// setApprovalForAll(address operator, bool approved) — blanket access
			if (selector === SET_APPROVAL_FOR_ALL_SELECTOR) {
				const [, approved] = decodeAbiParameters(SET_APPROVAL_FOR_ALL_PARAMS, params);
				return approved;
			}
		} catch {
			return false;
		}

		return false;
	}

	/**
	 * Check if calldata is a DEX swap with zero slippage (amountOutMin == 0).
	 */
	isZeroSlippageSwap(data?: string): boolean {
		if (!data || data.length < 10) return false;
		const selector = data.slice(0, 10).toLowerCase();

		try {
			if (selector === UNISWAP_V2_SWAP_EXACT_TOKENS) {
				const params = data.slice(10) as Hex;
				const [, amountOutMin] = decodeAbiParameters(SWAP_EXACT_TOKENS_PARAMS, `0x${params}`);
				return amountOutMin === 0n;
			}

			if (selector === UNISWAP_V2_SWAP_EXACT_ETH) {
				const params = data.slice(10) as Hex;
				const [amountOutMin] = decodeAbiParameters(SWAP_EXACT_ETH_PARAMS, `0x${params}`);
				return amountOutMin === 0n;
			}
		} catch {
			return false;
		}

		return false;
	}

	// ─── Private helpers ──────────────────────────────────────────────────────

	private async priceOutflow(
		outflow: Omit<DecodedOutflow, 'usdValue'>,
		chainId: number,
		priceOracle: PriceOracleService,
	): Promise<number | undefined> {
		if (outflow.token === 'native') {
			const nativePrice = await priceOracle.getNativePrice(chainId);
			if (!nativePrice) return undefined;
			return Number(formatUnits(outflow.amount, ETH_DECIMALS)) * nativePrice;
		}

		if (outflow.token === 'unknown') return undefined;

		const tokenPrice = await priceOracle.getTokenPrice(chainId, outflow.token);
		if (!tokenPrice) return undefined;
		const decimals = this.getTokenDecimals(chainId, outflow.token);
		return Number(formatUnits(outflow.amount, decimals)) * tokenPrice;
	}

	private decodeCalldata(data: Hex, toAddress?: string): Omit<DecodedOutflow, 'usdValue'> | null {
		const selector = data.slice(0, 10).toLowerCase();
		const params = `0x${data.slice(10)}` as Hex;

		try {
			switch (selector) {
				case TRANSFER_SELECTOR: {
					const [, amount] = decodeAbiParameters(TRANSFER_PARAMS, params);
					return { token: toAddress ?? 'unknown', amount };
				}
				case TRANSFER_FROM_SELECTOR: {
					const [, , amount] = decodeAbiParameters(TRANSFER_FROM_PARAMS, params);
					return { token: toAddress ?? 'unknown', amount };
				}
				case UNISWAP_V2_SWAP_EXACT_TOKENS: {
					const [amountIn] = decodeAbiParameters(SWAP_EXACT_TOKENS_PARAMS, params);
					return { token: 'unknown', amount: amountIn };
				}
				case UNISWAP_V3_EXACT_INPUT_SINGLE: {
					// ExactInputSingleParams struct — amountIn is at param index 4
					// Struct: (tokenIn, tokenOut, fee, recipient, deadline, amountIn, amountOutMinimum, sqrtPriceLimitX96)
					// Decoded as flat tuple
					const decoded = decodeAbiParameters(
						parseAbiParameters(
							'address, address, uint24, address, uint256, uint256, uint256, uint160',
						),
						params,
					);
					return { token: 'unknown', amount: decoded[5] };
				}
				default:
					return null;
			}
		} catch {
			return null;
		}
	}
}
