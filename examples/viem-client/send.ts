/**
 * Guardian Wallet + viem
 *
 * Direct WalletClient integration using ThresholdSigner.toViemAccount().
 * The full private key never exists — signing is 2-of-3 MPC.
 *
 * Usage:
 *   npx tsx send.ts
 */

import { createWalletClient, createPublicClient, http, parseEther, formatEther } from 'viem';
import { baseSepolia } from 'viem/chains';
import { ThresholdSigner } from '@agentokratia/guardian-signer';

const signer = await ThresholdSigner.fromFile({
	sharePath: process.env.SHARE_PATH || './my-agent.share.enc',
	passphrase: process.env.SHARE_PASSPHRASE!,
	serverUrl: process.env.GUARDIAN_SERVER || 'http://localhost:8080',
	apiKey: process.env.GUARDIAN_API_KEY!,
});

const account = signer.toViemAccount();
console.log(`Signer address: ${account.address}`);

const publicClient = createPublicClient({
	chain: baseSepolia,
	transport: http(),
});

const balance = await publicClient.getBalance({ address: account.address });
console.log(`Balance: ${formatEther(balance)} ETH`);

const client = createWalletClient({
	account,
	chain: baseSepolia,
	transport: http(),
});

const to = process.argv[2] || '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const value = parseEther(process.argv[3] || '0.001');

console.log(`\nSending ${formatEther(value)} ETH to ${to}...`);

const hash = await client.sendTransaction({ to: to as `0x${string}`, value });
console.log(`Transaction hash: ${hash}`);
console.log(`Explorer: https://sepolia.basescan.org/tx/${hash}`);
