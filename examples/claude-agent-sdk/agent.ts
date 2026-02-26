/**
 * Autonomous DeFi Rebalancing Agent — Guardian Wallet + Claude Agent SDK
 *
 * A fully autonomous portfolio manager that runs in a continuous loop:
 *   1. Reads on-chain balances (ETH + USDC) from Base Sepolia
 *   2. Reads ETH/USDC price from Uniswap V3 pool
 *   3. Claude decides when to rebalance based on allocation drift
 *   4. Executes swaps via Guardian 2-of-3 threshold signing (no private key)
 *   5. Logs trades and sleeps until next cycle
 *
 * Uses the Claude Agent SDK — same agent loop that powers Claude Code.
 * Custom tools defined as in-process MCP server.
 *
 * Usage:
 *   pnpm example:claude-agent
 *
 * Auth:
 *   Uses your existing `claude login` session — no API key needed.
 *   (Or set ANTHROPIC_API_KEY in examples/.env if you prefer API key auth.)
 *
 * Requires:
 *   GUARDIAN_* vars in examples/.env (server URL, API key, secret)
 */

import { Guardian } from '@agentokratia/guardian-signer';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import {
	http,
	createPublicClient,
	encodeFunctionData,
	formatEther,
	formatUnits,
	parseEther,
	parseUnits,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { z } from 'zod';

// ── Constants ───────────────────────────────────────────────────────────

const WETH = '0x4200000000000000000000000000000000000006' as const;
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
const UNISWAP_V3_FACTORY = '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24' as const;
const SWAP_ROUTER = '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4' as const;
const POOL_FEE = 3000; // 0.3%

const CYCLE_INTERVAL_MS = 60_000; // 60s between cycles
const MAX_CYCLES = 5;

// ── ABIs (minimal) ─────────────────────────────────────────────────────

const erc20Abi = [
	{
		name: 'balanceOf',
		type: 'function',
		stateMutability: 'view',
		inputs: [{ name: 'account', type: 'address' }],
		outputs: [{ name: '', type: 'uint256' }],
	},
	{
		name: 'decimals',
		type: 'function',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ name: '', type: 'uint8' }],
	},
] as const;

const factoryAbi = [
	{
		name: 'getPool',
		type: 'function',
		stateMutability: 'view',
		inputs: [
			{ name: 'tokenA', type: 'address' },
			{ name: 'tokenB', type: 'address' },
			{ name: 'fee', type: 'uint24' },
		],
		outputs: [{ name: 'pool', type: 'address' }],
	},
] as const;

const poolAbi = [
	{
		name: 'slot0',
		type: 'function',
		stateMutability: 'view',
		inputs: [],
		outputs: [
			{ name: 'sqrtPriceX96', type: 'uint160' },
			{ name: 'tick', type: 'int24' },
			{ name: 'observationIndex', type: 'uint16' },
			{ name: 'observationCardinality', type: 'uint16' },
			{ name: 'observationCardinalityNext', type: 'uint16' },
			{ name: 'feeProtocol', type: 'uint8' },
			{ name: 'unlocked', type: 'bool' },
		],
	},
] as const;

const swapRouterAbi = [
	{
		name: 'exactInputSingle',
		type: 'function',
		stateMutability: 'payable',
		inputs: [
			{
				name: 'params',
				type: 'tuple',
				components: [
					{ name: 'tokenIn', type: 'address' },
					{ name: 'tokenOut', type: 'address' },
					{ name: 'fee', type: 'uint24' },
					{ name: 'recipient', type: 'address' },
					{ name: 'amountIn', type: 'uint256' },
					{ name: 'amountOutMinimum', type: 'uint256' },
					{ name: 'sqrtPriceLimitX96', type: 'uint160' },
				],
			},
		],
		outputs: [{ name: 'amountOut', type: 'uint256' }],
	},
] as const;

// ── State ───────────────────────────────────────────────────────────────

interface Trade {
	cycle: number;
	direction: string;
	amountIn: string;
	txHash: string;
	timestamp: string;
}

const tradeLog: Trade[] = [];
let currentCycle = 0;

// ── Helpers ─────────────────────────────────────────────────────────────

function sqrtPriceX96ToPrice(sqrtPriceX96: bigint): number {
	// USDC (6 dec) is token0, WETH (18 dec) is token1 on Base
	// price = (sqrtPriceX96 / 2^96)^2 gives token0/token1 in raw units
	// ETH price in USDC = price_raw * 10^(18-6) = price_raw * 10^12
	const Q96 = 2n ** 96n;
	const numerator = sqrtPriceX96 * sqrtPriceX96;
	const denominator = Q96 * Q96;
	// Scale to avoid precision loss: multiply by 10^12 before dividing
	const scaled = (numerator * 10n ** 12n) / denominator;
	return Number(scaled) / 1e6; // Return price in USDC with 6 decimal places
}

function log(msg: string): void {
	const ts = new Date().toISOString().slice(11, 19);
	console.log(`  [${ts}] ${msg}`);
}

// ── Initialize Guardian + viem ──────────────────────────────────────────

const gw = await Guardian.connect({
	apiSecret: process.env.GUARDIAN_API_SECRET as string,
	serverUrl: process.env.GUARDIAN_SERVER || 'http://localhost:8080',
	apiKey: process.env.GUARDIAN_API_KEY as string,
});

const publicClient = createPublicClient({
	chain: baseSepolia,
	transport: http(),
});

// ── Custom MCP Tools ────────────────────────────────────────────────────

const checkPortfolio = tool(
	'check_portfolio',
	'Check the current portfolio: ETH balance, USDC balance, total value in USD, and allocation percentages. Use this to see the current state before deciding whether to rebalance.',
	{},
	async () => {
		const [ethBalance, usdcBalance] = await Promise.all([
			publicClient.getBalance({ address: gw.address as `0x${string}` }),
			publicClient.readContract({
				address: USDC,
				abi: erc20Abi,
				functionName: 'balanceOf',
				args: [gw.address as `0x${string}`],
			}),
		]);

		const ethAmount = Number(formatEther(ethBalance));
		const usdcAmount = Number(formatUnits(usdcBalance, 6));

		// Get ETH price for USD conversion
		let ethPriceUsd = 3200; // fallback
		try {
			const poolAddress = await publicClient.readContract({
				address: UNISWAP_V3_FACTORY,
				abi: factoryAbi,
				functionName: 'getPool',
				args: [USDC, WETH, POOL_FEE],
			});
			if (poolAddress !== '0x0000000000000000000000000000000000000000') {
				const slot0 = await publicClient.readContract({
					address: poolAddress as `0x${string}`,
					abi: poolAbi,
					functionName: 'slot0',
				});
				ethPriceUsd = sqrtPriceX96ToPrice(slot0[0]);
			}
		} catch {
			// Use fallback price
		}

		const ethValueUsd = ethAmount * ethPriceUsd;
		const totalUsd = ethValueUsd + usdcAmount;
		const ethAllocation = totalUsd > 0 ? (ethValueUsd / totalUsd) * 100 : 0;
		const usdcAllocation = totalUsd > 0 ? (usdcAmount / totalUsd) * 100 : 0;

		return {
			content: [
				{
					type: 'text' as const,
					text: JSON.stringify(
						{
							wallet: gw.address,
							network: 'base-sepolia',
							eth: { balance: ethAmount.toFixed(6), value_usd: ethValueUsd.toFixed(2) },
							usdc: { balance: usdcAmount.toFixed(2), value_usd: usdcAmount.toFixed(2) },
							total_value_usd: totalUsd.toFixed(2),
							allocation: {
								eth_pct: ethAllocation.toFixed(1),
								usdc_pct: usdcAllocation.toFixed(1),
							},
							eth_price_usd: ethPriceUsd.toFixed(2),
							target_allocation: '50% ETH / 50% USDC',
							rebalance_threshold: '10% drift',
						},
						null,
						2,
					),
				},
			],
		};
	},
);

const getEthPrice = tool(
	'get_eth_price',
	'Get the current ETH/USDC price from the Uniswap V3 pool on Base Sepolia.',
	{},
	async () => {
		try {
			const poolAddress = await publicClient.readContract({
				address: UNISWAP_V3_FACTORY,
				abi: factoryAbi,
				functionName: 'getPool',
				args: [USDC, WETH, POOL_FEE],
			});

			if (poolAddress === '0x0000000000000000000000000000000000000000') {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								source: 'fallback',
								eth_usdc: 3200.0,
								note: 'No Uniswap V3 WETH/USDC pool found on Base Sepolia — using fallback price.',
							}),
						},
					],
				};
			}

			const slot0 = await publicClient.readContract({
				address: poolAddress as `0x${string}`,
				abi: poolAbi,
				functionName: 'slot0',
			});

			const price = sqrtPriceX96ToPrice(slot0[0]);
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({
							source: 'uniswap_v3',
							pool: poolAddress,
							fee_tier: '0.3%',
							eth_usdc: price.toFixed(2),
							tick: Number(slot0[1]),
						}),
					},
				],
			};
		} catch (err: unknown) {
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({
							source: 'fallback',
							eth_usdc: 3200.0,
							error: err instanceof Error ? err.message : String(err),
						}),
					},
				],
			};
		}
	},
);

const swapEthToUsdc = tool(
	'swap_eth_to_usdc',
	'Swap ETH for USDC on Uniswap V3 via Guardian threshold signing. The private key NEVER exists — signing is 2-of-3 MPC. The SwapRouter wraps ETH to WETH internally.',
	{
		amount_eth: z.string().describe('Amount of ETH to swap (e.g. "0.01")'),
		min_usdc_out: z
			.string()
			.optional()
			.describe('Minimum USDC to receive (slippage protection). Default: 0 (no limit)'),
	},
	async ({ amount_eth, min_usdc_out }) => {
		log(`Threshold signing: ${amount_eth} ETH → USDC`);

		const amountIn = parseEther(amount_eth);
		const minOut = min_usdc_out ? parseUnits(min_usdc_out, 6) : 0n;

		const calldata = encodeFunctionData({
			abi: swapRouterAbi,
			functionName: 'exactInputSingle',
			args: [
				{
					tokenIn: WETH,
					tokenOut: USDC,
					fee: POOL_FEE,
					recipient: gw.address as `0x${string}`,
					amountIn,
					amountOutMinimum: minOut,
					sqrtPriceLimitX96: 0n,
				},
			],
		});

		try {
			const result = await gw.signTransaction({
				to: SWAP_ROUTER,
				data: calldata,
				value: amountIn.toString(),
				chainId: baseSepolia.id,
			});

			const trade: Trade = {
				cycle: currentCycle,
				direction: 'ETH → USDC',
				amountIn: `${amount_eth} ETH`,
				txHash: result.txHash,
				timestamp: new Date().toISOString(),
			};
			tradeLog.push(trade);

			log(`Swap executed: ${result.txHash}`);

			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({
							success: true,
							direction: 'ETH → USDC',
							amount_in: `${amount_eth} ETH`,
							tx_hash: result.txHash,
							explorer: `https://sepolia.basescan.org/tx/${result.txHash}`,
							signing: '2-of-3 threshold ECDSA (key never existed)',
						}),
					},
				],
			};
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			log(`Swap failed: ${msg}`);
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: msg }) }],
			};
		}
	},
);

const signAttestation = tool(
	'sign_attestation',
	'Sign a cryptographic attestation message as proof-of-action. Use this after completing trades to create a verifiable record.',
	{
		message: z
			.string()
			.describe(
				'Attestation message (e.g. "rebalance::cycle-1::0.01-ETH-to-USDC::2026-02-19T12:00:00Z")',
			),
	},
	async ({ message }) => {
		log(`Signing attestation: "${message}"`);
		const result = await gw.signMessage(message);
		return {
			content: [
				{
					type: 'text' as const,
					text: JSON.stringify({
						attestation: message,
						signature: result.signature,
						signer: gw.address,
						signing: '2-of-3 threshold ECDSA',
					}),
				},
			],
		};
	},
);

const getTradeLog = tool(
	'get_trade_log',
	'Get the trade history for this session. Shows all swaps executed, with timestamps and transaction hashes.',
	{},
	async () => {
		if (tradeLog.length === 0) {
			return { content: [{ type: 'text' as const, text: 'No trades executed yet this session.' }] };
		}
		return {
			content: [{ type: 'text' as const, text: JSON.stringify(tradeLog, null, 2) }],
		};
	},
);

// ── MCP Server ──────────────────────────────────────────────────────────

const guardianDefi = createSdkMcpServer({
	name: 'guardian-defi',
	version: '1.0.0',
	tools: [checkPortfolio, getEthPrice, swapEthToUsdc, signAttestation, getTradeLog],
});

// ── System Prompt ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an autonomous DeFi portfolio manager operating a treasury wallet on Base Sepolia.

YOUR WALLET:
- Address: ${gw.address}
- Signing: 2-of-3 threshold ECDSA — the full private key NEVER exists

YOUR STRATEGY:
- Target allocation: 50% ETH / 50% USDC
- Rebalance threshold: ±10% drift from target
- Always keep a 0.001 ETH buffer for gas
- Pay HIGH priority to minimizing unnecessary trades (gas costs matter)

EACH CYCLE:
1. Check portfolio (balances + allocation)
2. Check ETH price
3. If allocation drifts >10% from 50/50, execute a swap to rebalance
4. If no rebalance needed, explain why and wait
5. After any trade, sign an attestation as proof-of-settlement

RULES:
- Be concise. State facts, make decisions, act.
- Never swap more than needed to reach target allocation
- If a swap fails (insufficient liquidity, policy block), adapt and explain
- Always report: current allocation, decision, action taken (or skipped), new allocation`;

// ── Main — Autonomous Loop ──────────────────────────────────────────────

console.log('\n  ┌──────────────────────────────────────────────────────┐');
console.log('  │  Guardian Autonomous DeFi Agent                      │');
console.log('  │  Claude Agent SDK + 2-of-3 Threshold Signing         │');
console.log('  │  Strategy: 50/50 ETH/USDC rebalance at ±10% drift   │');
console.log('  └──────────────────────────────────────────────────────┘\n');

log(`Wallet: ${gw.address}`);
log(`Network: Base Sepolia (${baseSepolia.id})`);
log(`Cycle interval: ${CYCLE_INTERVAL_MS / 1000}s`);
console.log();

for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
	currentCycle = cycle;
	console.log(`  ── Cycle ${cycle}/${MAX_CYCLES} ─────────────────────────────────────`);

	const prompt = [
		`Cycle #${cycle} — ${new Date().toISOString()}`,
		'',
		'Run the portfolio check. If rebalance is needed, execute it.',
		cycle > 1
			? `Previous trades this session: ${tradeLog.length}`
			: 'First cycle — no prior trades.',
	].join('\n');

	for await (const message of query({
		prompt,
		options: {
			systemPrompt: SYSTEM_PROMPT,
			mcpServers: { 'guardian-defi': guardianDefi },
			allowedTools: ['mcp__guardian-defi__*'],
			permissionMode: 'bypassPermissions',
			allowDangerouslySkipPermissions: true,
			model: 'claude-sonnet-4-5-20250929',
			maxTurns: 15,
		},
	})) {
		if (message.type === 'assistant' && message.message?.content) {
			for (const block of message.message.content) {
				if ('text' in block && block.text) {
					// Print Claude's reasoning
					for (const line of block.text.split('\n')) {
						console.log(`  ${line}`);
					}
				} else if ('name' in block) {
					log(`Claude → ${block.name}()`);
				}
			}
		} else if (message.type === 'result') {
			if (message.subtype === 'success') {
				log(`Cycle ${cycle} complete.`);
			} else {
				log(`Cycle ${cycle} ended: ${message.subtype}`);
			}
		}
	}

	console.log();

	if (cycle < MAX_CYCLES) {
		log(`Sleeping ${CYCLE_INTERVAL_MS / 1000}s until next cycle...`);
		await new Promise((r) => setTimeout(r, CYCLE_INTERVAL_MS));
	}
}

// Cleanup
gw.destroy();
log('Agent terminated. Key material wiped.');
log(`Session summary: ${tradeLog.length} trades executed across ${MAX_CYCLES} cycles.`);
