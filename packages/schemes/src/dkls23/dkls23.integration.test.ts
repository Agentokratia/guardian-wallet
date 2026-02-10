import { type ChildProcess, spawn } from 'node:child_process';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { Keyshare } from '@silencelaboratories/dkls-wasm-ll-node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	createPublicClient,
	http,
	keccak256,
	parseEther,
	parseGwei,
	recoverAddress,
	serializeTransaction,
	toHex,
	type TransactionSerializableEIP1559,
} from 'viem';
import { mainnet } from 'viem/chains';
import { DKLs23Scheme } from './dkls23.scheme.js';

/**
 * End-to-end integration tests for the DKLs23 threshold ECDSA scheme.
 *
 * PROVES:
 * 1. DKG (5-round) generates valid keyshares with a correct Ethereum address
 * 2. Any 2-of-3 keyshares can interactively sign → valid ECDSA → correct address recovery
 * 3. A threshold-signed tx can be submitted on a real Ethereum mainnet fork (Anvil)
 */

function keccak256ToBytes(hex: string): Uint8Array {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
	const bytes = new Uint8Array(clean.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

describe('DKLs23 Integration — Real WASM Crypto', () => {
	const scheme = new DKLs23Scheme();
	let shares: Uint8Array[];
	let publicKey: Uint8Array;
	let ethAddress: string;

	// ============================================================
	// 1. DKG — Distributed Key Generation (5 interactive rounds)
	// ============================================================
	describe('1. DKG — generates valid keyshares for an Ethereum address', () => {
		it('completes 5-round DKG producing 3 shares + public key', async () => {
			const sid = `dkg-${crypto.randomUUID()}`;

			const r1 = await scheme.dkg(sid, 1, []);
			expect(r1.finished).toBe(false);
			expect(r1.outgoing.length).toBeGreaterThan(0);

			const r2 = await scheme.dkg(sid, 2, r1.outgoing);
			expect(r2.finished).toBe(false);

			const r3 = await scheme.dkg(sid, 3, r2.outgoing);
			expect(r3.finished).toBe(false);

			const r4 = await scheme.dkg(sid, 4, r3.outgoing);
			expect(r4.finished).toBe(false);

			const r5 = await scheme.dkg(sid, 5, r4.outgoing);
			expect(r5.finished).toBe(true);
			expect(r5.shares).toHaveLength(3);
			expect(r5.publicKey).toBeDefined();

			publicKey = r5.publicKey!;
			shares = r5.shares!;

			// Compressed secp256k1 public key: 33 bytes, 0x02 or 0x03 prefix
			expect(publicKey.length).toBe(33);
			expect(publicKey[0] === 0x02 || publicKey[0] === 0x03).toBe(true);

			// Real keyshares are large binary blobs (not 32-byte mock stubs)
			for (const s of shares) {
				expect(s.length).toBeGreaterThan(100);
			}

			ethAddress = scheme.deriveAddress(publicKey);
			expect(ethAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);

			console.log('');
			console.log('  ┌─── DKG RESULTS ───────────────────────────────────────');
			console.log(`  │ Public key : ${toHex(publicKey)}`);
			console.log(`  │ ETH address: ${ethAddress}`);
			console.log(`  │ Share sizes: ${shares.map((s) => `${s.length}B`).join(', ')}`);
			console.log('  └────────────────────────────────────────────────────────');
		}, 60_000);

		it('all 3 keyshares contain the same public key', () => {
			for (let i = 0; i < shares.length; i++) {
				const ks = Keyshare.fromBytes(shares[i]!);
				expect(toHex(new Uint8Array(ks.publicKey))).toBe(toHex(publicKey));
				expect(ks.threshold).toBe(2);
				expect(ks.participants).toBe(3);
			}
		});
	});

	// ============================================================
	// 2. Interactive 2-of-3 Threshold Signing (all 3 combinations)
	// ============================================================
	describe('2. Interactive signing — every 2-of-3 combination', () => {
		async function signAndVerify(
			label: string,
			shareA: Uint8Array,
			shareB: Uint8Array,
		) {
			const msgHash = new Uint8Array(32);
			crypto.getRandomValues(msgHash);

			// Create interactive sign session with 2 keyshares
			const { sessionId, firstMessages } = scheme.createSignSession([shareA, shareB]);
			expect(firstMessages.length).toBe(2);

			// Process signing rounds until presigned
			let msgs = firstMessages;
			let presigned = false;
			let rounds = 0;
			while (!presigned) {
				const result = scheme.processSignRound(sessionId, msgs);
				msgs = result.outgoingMessages;
				presigned = result.presigned;
				rounds++;
				if (rounds > 10) throw new Error('Too many signing rounds');
			}

			// Finalize with the message hash → get (r, s, v)
			const { r, s, v } = scheme.finalizeSign(sessionId, msgHash, []);
			expect(r.length).toBe(32);
			expect(s.length).toBe(32);
			expect(v === 27 || v === 28).toBe(true);

			// PROOF 1: secp256k1.verify confirms valid ECDSA signature
			const compact = new Uint8Array(64);
			compact.set(r, 0);
			compact.set(s, 32);
			const isValid = secp256k1.verify(compact, msgHash, publicKey, { prehash: false });
			expect(isValid).toBe(true);

			// PROOF 2: ecrecover → correct Ethereum address
			const recovered = await recoverAddress({
				hash: toHex(msgHash),
				signature: {
					r: toHex(r),
					s: toHex(s),
					v: BigInt(v),
				},
			});
			expect(recovered.toLowerCase()).toBe(ethAddress.toLowerCase());

			console.log(`  ${label}: ${rounds} rounds, v=${v}, ecrecover=${recovered}`);
		}

		it('shares 0+1 (signer + server)', async () => {
			await signAndVerify('shares 0+1', shares[0]!, shares[1]!);
		}, 60_000);

		it('shares 0+2 (signer + user)', async () => {
			await signAndVerify('shares 0+2', shares[0]!, shares[2]!);
		}, 60_000);

		it('shares 1+2 (server + user)', async () => {
			await signAndVerify('shares 1+2', shares[1]!, shares[2]!);
		}, 60_000);
	});

	// ============================================================
	// 3. Mainnet Fork — Submit Real ETH Transfer via Anvil
	// ============================================================
	describe('3. Mainnet fork — real transaction on-chain', () => {
		let anvil: ChildProcess;
		const PORT = 18545;
		const RPC = `http://127.0.0.1:${PORT}`;
		const DEAD = '0x000000000000000000000000000000000000dEaD' as const;
		const FORK_URL = process.env.ETH_RPC_URL ?? 'https://ethereum-rpc.publicnode.com';

		beforeAll(async () => {
			// Start Anvil with mainnet fork
			anvil = spawn(
				process.env.ANVIL_PATH ?? 'anvil',
				['--fork-url', FORK_URL, '--port', String(PORT), '--silent'],
				{ stdio: 'ignore' },
			);

			// Wait for Anvil to be ready (poll up to 30s)
			let ready = false;
			for (let i = 0; i < 30; i++) {
				try {
					const res = await fetch(RPC, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							jsonrpc: '2.0',
							id: 1,
							method: 'eth_blockNumber',
							params: [],
						}),
					});
					if (res.ok) {
						ready = true;
						break;
					}
				} catch {
					/* retry */
				}
				await new Promise((r) => setTimeout(r, 1000));
			}
			if (!ready) throw new Error('Anvil failed to start — check FORK_URL');

			// Fund the threshold address with 10 ETH
			await fetch(RPC, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'anvil_setBalance',
					params: [ethAddress, toHex(parseEther('10'))],
				}),
			});
		}, 60_000);

		afterAll(() => {
			if (anvil) {
				anvil.kill('SIGTERM');
				// Fallback kill after 3s
				setTimeout(() => {
					try {
						anvil.kill('SIGKILL');
					} catch {
						/* already dead */
					}
				}, 3000);
			}
		});

		it('threshold-signs and confirms 0.01 ETH transfer on mainnet fork', async () => {
			const client = createPublicClient({
				chain: mainnet,
				transport: http(RPC),
			});

			// Verify funded balance
			const balance = await client.getBalance({
				address: ethAddress as `0x${string}`,
			});
			expect(balance).toBe(parseEther('10'));

			// Get chain state
			const nonce = await client.getTransactionCount({
				address: ethAddress as `0x${string}`,
			});
			const block = await client.getBlock();
			const baseFee = block.baseFeePerGas ?? parseGwei('30');
			const tip = parseGwei('1');
			const maxFee = baseFee * 2n > tip ? baseFee * 2n : tip + parseGwei('1');

			// Build EIP-1559 transaction
			const tx: TransactionSerializableEIP1559 = {
				type: 'eip1559',
				chainId: 1,
				nonce,
				to: DEAD,
				value: parseEther('0.01'),
				gas: 21000n,
				maxFeePerGas: maxFee,
				maxPriorityFeePerGas: tip,
			};

			// Compute signing digest: keccak256(RLP(unsigned tx))
			const unsignedRlp = serializeTransaction(tx);
			const digest = keccak256(unsignedRlp);
			const digestBytes = keccak256ToBytes(digest);
			expect(digestBytes.length).toBe(32);

			// ---- THRESHOLD SIGN (shares 0 + 1) ----
			const { sessionId, firstMessages } = scheme.createSignSession([
				shares[0]!,
				shares[1]!,
			]);

			let msgs = firstMessages;
			let presigned = false;
			while (!presigned) {
				const res = scheme.processSignRound(sessionId, msgs);
				msgs = res.outgoingMessages;
				presigned = res.presigned;
			}

			const { r, s, v } = scheme.finalizeSign(sessionId, digestBytes, []);

			// Verify signature before broadcast
			const compact = new Uint8Array(64);
			compact.set(r, 0);
			compact.set(s, 32);
			expect(secp256k1.verify(compact, digestBytes, publicKey, { prehash: false })).toBe(true);

			// Serialize signed transaction (EIP-1559 uses yParity, not v)
			const signedRlp = serializeTransaction(tx, {
				r: toHex(r),
				s: toHex(s),
				yParity: v - 27,
			});

			// Broadcast via JSON-RPC
			const sendRes = await fetch(RPC, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'eth_sendRawTransaction',
					params: [signedRlp],
				}),
			});
			const sendJson = (await sendRes.json()) as {
				result?: string;
				error?: { message: string };
			};
			if (sendJson.error) {
				throw new Error(`eth_sendRawTransaction failed: ${sendJson.error.message}`);
			}
			const txHash = sendJson.result!;
			expect(txHash).toMatch(/^0x[0-9a-f]{64}$/);

			// Mine the block
			await fetch(RPC, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'evm_mine',
					params: [],
				}),
			});

			// Get receipt and verify
			const receipt = await client.getTransactionReceipt({
				hash: txHash as `0x${string}`,
			});
			expect(receipt.status).toBe('success');
			expect(receipt.from.toLowerCase()).toBe(ethAddress.toLowerCase());
			expect(receipt.to?.toLowerCase()).toBe(DEAD.toLowerCase());

			const newBalance = await client.getBalance({
				address: ethAddress as `0x${string}`,
			});
			expect(newBalance).toBeLessThan(parseEther('10'));

			console.log('');
			console.log('  ┌─── MAINNET FORK PROOF ──────────────────────────────────');
			console.log(`  │ Tx hash : ${txHash}`);
			console.log(`  │ From    : ${receipt.from}`);
			console.log(`  │ To      : ${receipt.to}`);
			console.log(`  │ Value   : 0.01 ETH`);
			console.log(`  │ Block   : ${receipt.blockNumber}`);
			console.log(`  │ Gas used: ${receipt.gasUsed}`);
			console.log(`  │ Status  : SUCCESS`);
			console.log('  └──────────────────────────────────────────────────────────');
		}, 120_000);
	});
});
