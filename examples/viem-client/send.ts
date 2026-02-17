/**
 * Guardian Wallet + viem
 *
 * Direct integration using ThresholdSigner — the full private key never
 * exists. Signing is 2-of-3 MPC.
 *
 * - toViemAccount() for reads + message signing
 * - signer.signTransaction() for sending (server broadcasts the tx)
 *
 * Usage:
 *   npx tsx send.ts [to] [amountInEth]
 */

import { ThresholdSigner } from '@agentokratia/guardian-signer';
import { http, createPublicClient, formatEther, parseEther } from 'viem';
import { baseSepolia } from 'viem/chains';

const signer = await ThresholdSigner.fromSecret({
	apiSecret: process.env.GUARDIAN_API_SECRET as string,
	serverUrl: process.env.GUARDIAN_SERVER || 'http://localhost:8080',
	apiKey: process.env.GUARDIAN_API_KEY as string,
});

const account = signer.toViemAccount();
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

// Use signer.signTransaction() directly — the Guardian server signs and
// broadcasts in one step, returning the on-chain txHash.
const result = await signer.signTransaction({
	to,
	value: value.toString(),
	network: 'base-sepolia',
});

console.log(`Transaction hash: ${result.txHash}`);
console.log(`Explorer: https://sepolia.basescan.org/tx/${result.txHash}`);

signer.destroy();
