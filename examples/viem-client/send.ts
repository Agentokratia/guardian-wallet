/**
 * Guardian Wallet + viem
 *
 * Direct integration using Guardian.connect() — the full private key never
 * exists. Signing is 2-of-3 MPC.
 *
 * - toViemAccount() for reads + message signing
 * - gw.signTransaction() for sending (server broadcasts the tx)
 *
 * Usage:
 *   npx tsx send.ts [to] [amountInEth]
 */

import { Guardian } from '@agentokratia/guardian-signer';
import { http, createPublicClient, formatEther, parseEther } from 'viem';
import { baseSepolia } from 'viem/chains';

const gw = await Guardian.connect({
	apiSecret: process.env.GUARDIAN_API_SECRET as string,
	serverUrl: process.env.GUARDIAN_SERVER || 'http://localhost:8080',
	apiKey: process.env.GUARDIAN_API_KEY as string,
});

const account = gw.toViemAccount();
console.log(`Signer address: ${account.address}`);

const publicClient = createPublicClient({
	chain: baseSepolia,
	transport: http(),
});

const balance = await publicClient.getBalance({ address: account.address });
console.log(`Balance: ${formatEther(balance)} ETH`);

const to = process.argv[2];
const amount = process.argv[3];

if (!to || !amount) {
	console.error('Usage: pnpm example:viem <to> <amount>');
	console.error('  e.g. pnpm example:viem 0xRecipient 0.001');
	process.exit(1);
}

const value = parseEther(amount);

console.log(`\nSending ${formatEther(value)} ETH to ${to}...`);

// Guardian.signTransaction() — the server signs and broadcasts in one step.
const result = await gw.signTransaction({
	to,
	value: value.toString(),
	network: 'base-sepolia',
});

console.log(`Transaction hash: ${result.txHash}`);
console.log(`Explorer: https://sepolia.basescan.org/tx/${result.txHash}`);

gw.destroy();
