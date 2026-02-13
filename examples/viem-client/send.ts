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

import { createPublicClient, http, parseEther, formatEther } from 'viem';
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

const to = process.argv[2] || '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const value = parseEther(process.argv[3] || '0.001');

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
