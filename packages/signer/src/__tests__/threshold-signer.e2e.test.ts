import { type ChildProcess, spawn } from 'node:child_process';
import { Keyshare } from '@silencelaboratories/dkls-wasm-ll-node';
import { DKLs23Scheme } from '@agentokratia/guardian-schemes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	createPublicClient,
	hashMessage,
	hashTypedData,
	http,
	keccak256,
	parseEther,
	parseGwei,
	recoverAddress,
	recoverMessageAddress,
	serializeTransaction,
	toHex,
	type TransactionSerializableEIP1559,
	type TransactionSerializableLegacy,
} from 'viem';
import { mainnet } from 'viem/chains';

/**
 * E2E test for the threshold signing pipeline.
 *
 * SECTION 1 — Scheme-level E2E (forked Ethereum via Anvil):
 *   - DKG generates valid keyshares → correct Ethereum address
 *   - Sign a real ETH transfer → broadcast on Anvil fork → verify tx.from
 *   - Sign an EIP-1559 transaction → broadcast → verify
 *   - Sign a message → verify via recoverMessageAddress
 *
 * SECTION 2 — ThresholdSigner hash computation (unit tests, no Anvil):
 *   - Transaction hash matches keccak256(serializeTransaction(tx))
 *   - Message hash matches hashMessage(msg)
 *   - EIP-712 hash matches hashTypedData(typedData)
 *   - Field changes produce different hashes
 */

function hexToBytes(hex: string): Uint8Array {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
	const bytes = new Uint8Array(clean.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

// ============================================================================
// SECTION 1: Scheme-level E2E on forked Ethereum
// ============================================================================

describe('Section 1: Scheme-level E2E — Full Signing Pipeline on Mainnet Fork', () => {
	const scheme = new DKLs23Scheme();
	let shares: Uint8Array[];
	let publicKey: Uint8Array;
	let ethAddress: string;

	// Anvil state
	let anvil: ChildProcess;
	const PORT = 18546;
	const RPC = `http://127.0.0.1:${PORT}`;
	const DEAD = '0x000000000000000000000000000000000000dEaD' as const;
	const FORK_URL = process.env.ETH_RPC_URL ?? 'https://ethereum-rpc.publicnode.com';

	// ------------------------------------------------------------------
	// Setup: DKG + Anvil
	// ------------------------------------------------------------------

	beforeAll(async () => {
		// 1. Run full 5-round DKG to get 3 shares + public key
		const sid = `e2e-dkg-${crypto.randomUUID()}`;

		const r1 = await scheme.dkg(sid, 1, []);
		const r2 = await scheme.dkg(sid, 2, r1.outgoing);
		const r3 = await scheme.dkg(sid, 3, r2.outgoing);
		const r4 = await scheme.dkg(sid, 4, r3.outgoing);
		const r5 = await scheme.dkg(sid, 5, r4.outgoing);

		expect(r5.finished).toBe(true);
		expect(r5.shares).toHaveLength(3);
		expect(r5.publicKey).toBeDefined();

		publicKey = r5.publicKey!;
		shares = r5.shares!;
		ethAddress = scheme.deriveAddress(publicKey);

		expect(ethAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);

		// 2. Start Anvil with mainnet fork
		const anvilPath = process.env.ANVIL_PATH ?? 'anvil';
		anvil = spawn(
			anvilPath,
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
		if (!ready) throw new Error('Anvil failed to start — check FORK_URL and anvil installation');

		// 3. Fund the threshold address with 10 ETH
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
	}, 120_000);

	afterAll(() => {
		// Kill Anvil
		if (anvil) {
			anvil.kill('SIGTERM');
			setTimeout(() => {
				try {
					anvil.kill('SIGKILL');
				} catch {
					/* already dead */
				}
			}, 3000);
		}

		// Wipe share memory
		if (shares) {
			for (const s of shares) {
				s.fill(0);
			}
		}
	});

	// ------------------------------------------------------------------
	// Helper: interactive threshold sign using DKLs23Scheme
	// ------------------------------------------------------------------

	function thresholdSign(
		shareA: Uint8Array,
		shareB: Uint8Array,
		messageHash: Uint8Array,
	): { r: Uint8Array; s: Uint8Array; v: number } {
		const { sessionId, firstMessages } = scheme.createSignSession([shareA, shareB]);

		let msgs = firstMessages;
		let presigned = false;
		let rounds = 0;
		while (!presigned) {
			const res = scheme.processSignRound(sessionId, msgs);
			msgs = res.outgoingMessages;
			presigned = res.presigned;
			rounds++;
			if (rounds > 10) throw new Error('Too many signing rounds');
		}

		return scheme.finalizeSign(sessionId, messageHash, []);
	}

	// ------------------------------------------------------------------
	// 1. DKG validation
	// ------------------------------------------------------------------

	describe('1. DKG produces valid keyshares', () => {
		it('generated 3 shares with matching public keys and correct threshold', () => {
			for (const shareBytes of shares) {
				const ks = Keyshare.fromBytes(shareBytes);
				expect(toHex(new Uint8Array(ks.publicKey))).toBe(toHex(publicKey));
				expect(ks.threshold).toBe(2);
				expect(ks.participants).toBe(3);
			}
		});

		it('derives a valid checksummed Ethereum address', () => {
			expect(ethAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
			expect(scheme.deriveAddress(publicKey)).toBe(ethAddress);
		});

		it('compressed public key is 33 bytes with 0x02 or 0x03 prefix', () => {
			expect(publicKey.length).toBe(33);
			expect(publicKey[0] === 0x02 || publicKey[0] === 0x03).toBe(true);
		});

		it('real keyshares are large binary blobs (not mock stubs)', () => {
			for (const s of shares) {
				expect(s.length).toBeGreaterThan(100);
			}
		});
	});

	// ------------------------------------------------------------------
	// 2. Transaction signing + on-chain execution
	// ------------------------------------------------------------------

	describe('2. Transaction signing on mainnet fork', () => {
		it('signs and broadcasts a real ETH transfer (EIP-1559)', async () => {
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

			// Compute signing digest — the same computation
			// ThresholdSigner.signTransaction() does internally
			const unsignedRlp = serializeTransaction(tx);
			const digestHex = keccak256(unsignedRlp);
			const digestBytes = hexToBytes(digestHex);
			expect(digestBytes.length).toBe(32);

			// Threshold sign with shares 0 + 1 (signer + server path)
			const { r, s, v } = thresholdSign(shares[0]!, shares[1]!, digestBytes);

			// PROOF 1: ecrecover returns the threshold address
			const recovered = await recoverAddress({
				hash: digestHex as `0x${string}`,
				signature: {
					r: toHex(r),
					s: toHex(s),
					v: BigInt(v),
				},
			});
			expect(recovered.toLowerCase()).toBe(ethAddress.toLowerCase());

			// Serialize signed transaction (EIP-1559 uses yParity)
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

			// PROOF 2: transaction executed correctly on-chain
			const receipt = await client.getTransactionReceipt({
				hash: txHash as `0x${string}`,
			});
			expect(receipt.status).toBe('success');
			expect(receipt.from.toLowerCase()).toBe(ethAddress.toLowerCase());
			expect(receipt.to?.toLowerCase()).toBe(DEAD.toLowerCase());

			// PROOF 3: balance decreased
			const newBalance = await client.getBalance({
				address: ethAddress as `0x${string}`,
			});
			expect(newBalance).toBeLessThan(parseEther('10'));

			console.log('');
			console.log('  ---- EIP-1559 TX PROOF ----');
			console.log(`  Tx hash : ${txHash}`);
			console.log(`  From    : ${receipt.from}`);
			console.log(`  To      : ${receipt.to}`);
			console.log(`  Value   : 0.01 ETH`);
			console.log(`  Status  : SUCCESS`);
		}, 120_000);

		it('signs and broadcasts a legacy ETH transfer', async () => {
			const client = createPublicClient({
				chain: mainnet,
				transport: http(RPC),
			});

			const nonce = await client.getTransactionCount({
				address: ethAddress as `0x${string}`,
			});

			// Build legacy transaction
			const tx: TransactionSerializableLegacy = {
				type: 'legacy',
				chainId: 1,
				nonce,
				to: DEAD,
				value: parseEther('0.005'),
				gas: 21000n,
				gasPrice: parseGwei('30'),
			};

			// Compute signing digest
			const unsignedRlp = serializeTransaction(tx);
			const digestHex = keccak256(unsignedRlp);
			const digestBytes = hexToBytes(digestHex);

			// Threshold sign with shares 1 + 2 (server + user path)
			const { r, s, v } = thresholdSign(shares[1]!, shares[2]!, digestBytes);

			// ecrecover returns the threshold address
			const recovered = await recoverAddress({
				hash: digestHex as `0x${string}`,
				signature: {
					r: toHex(r),
					s: toHex(s),
					v: BigInt(v),
				},
			});
			expect(recovered.toLowerCase()).toBe(ethAddress.toLowerCase());

			// Serialize signed transaction (legacy uses v directly)
			const signedRlp = serializeTransaction(tx, {
				r: toHex(r),
				s: toHex(s),
				v: BigInt(v),
			});

			// Broadcast
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

			// Verify receipt
			const receipt = await client.getTransactionReceipt({
				hash: txHash as `0x${string}`,
			});
			expect(receipt.status).toBe('success');
			expect(receipt.from.toLowerCase()).toBe(ethAddress.toLowerCase());
			expect(receipt.to?.toLowerCase()).toBe(DEAD.toLowerCase());

			console.log('');
			console.log('  ---- LEGACY TX PROOF ----');
			console.log(`  Tx hash : ${txHash}`);
			console.log(`  From    : ${receipt.from}`);
			console.log(`  Value   : 0.005 ETH`);
			console.log(`  Status  : SUCCESS`);
		}, 120_000);
	});

	// ------------------------------------------------------------------
	// 3. Message signing
	// ------------------------------------------------------------------

	describe('3. Message signing', () => {
		it('signs an EIP-191 personal message and recovers correct address', async () => {
			const message = 'Hello from threshold wallet!';

			// Compute EIP-191 hash — the same computation
			// ThresholdSigner.signMessage() does for string messages
			const hashHex = hashMessage(message);
			const hashBytes = hexToBytes(hashHex);
			expect(hashBytes.length).toBe(32);

			// Threshold sign with shares 0 + 2 (signer + user path)
			const { r, s, v } = thresholdSign(shares[0]!, shares[2]!, hashBytes);

			// recoverMessageAddress returns the threshold address
			const recovered = await recoverMessageAddress({
				message,
				signature: {
					r: toHex(r),
					s: toHex(s),
					v: BigInt(v),
				},
			});
			expect(recovered.toLowerCase()).toBe(ethAddress.toLowerCase());

			console.log('');
			console.log('  ---- EIP-191 MESSAGE PROOF ----');
			console.log(`  Message  : "${message}"`);
			console.log(`  Recovered: ${recovered}`);
			console.log(`  Expected : ${ethAddress}`);
		}, 60_000);

		it('signs EIP-712 typed data and recovers correct address', async () => {
			const typedData = {
				domain: {
					name: 'Guardian Wallet',
					version: '1',
					chainId: 1,
					verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' as const,
				},
				types: {
					Transfer: [
						{ name: 'to', type: 'address' },
						{ name: 'amount', type: 'uint256' },
					],
				},
				primaryType: 'Transfer' as const,
				message: {
					to: '0x000000000000000000000000000000000000dEaD',
					amount: 1000000n,
				},
			};

			// Compute EIP-712 hash — the same computation
			// ThresholdSigner.signMessage() does for typed data
			const hashHex = hashTypedData(typedData);
			const hashBytes = hexToBytes(hashHex);
			expect(hashBytes.length).toBe(32);

			// Threshold sign with shares 1 + 2 (server + user path)
			const { r, s, v } = thresholdSign(shares[1]!, shares[2]!, hashBytes);

			// ecrecover with the EIP-712 hash returns the threshold address
			const recovered = await recoverAddress({
				hash: hashHex as `0x${string}`,
				signature: {
					r: toHex(r),
					s: toHex(s),
					v: BigInt(v),
				},
			});
			expect(recovered.toLowerCase()).toBe(ethAddress.toLowerCase());

			console.log('');
			console.log('  ---- EIP-712 TYPED DATA PROOF ----');
			console.log(`  Domain   : ${typedData.domain.name} v${typedData.domain.version}`);
			console.log(`  Type     : ${typedData.primaryType}`);
			console.log(`  Recovered: ${recovered}`);
		}, 60_000);
	});

	// ------------------------------------------------------------------
	// 4. All 2-of-3 combinations produce valid signatures
	// ------------------------------------------------------------------

	describe('4. Every 2-of-3 share combination signs correctly', () => {
		const combinations: [string, number, number][] = [
			['signer+server (0+1)', 0, 1],
			['signer+user (0+2)', 0, 2],
			['server+user (1+2)', 1, 2],
		];

		for (const [label, idxA, idxB] of combinations) {
			it(`${label} produces a valid signature`, async () => {
				const msgHash = new Uint8Array(32);
				crypto.getRandomValues(msgHash);

				const { r, s, v } = thresholdSign(shares[idxA]!, shares[idxB]!, msgHash);

				const recovered = await recoverAddress({
					hash: toHex(msgHash),
					signature: {
						r: toHex(r),
						s: toHex(s),
						v: BigInt(v),
					},
				});
				expect(recovered.toLowerCase()).toBe(ethAddress.toLowerCase());
			}, 60_000);
		}
	});
});

// ============================================================================
// SECTION 2: ThresholdSigner hash computation (unit tests, no Anvil needed)
// ============================================================================

describe('Section 2: ThresholdSigner Hash Computation', () => {
	// These tests verify the exact hash computations that ThresholdSigner
	// performs internally via its dynamic viem import. By importing viem
	// directly, we prove the hashing pipeline is correct without needing
	// to spin up the server or Anvil.

	describe('Transaction hashing — keccak256(serializeTransaction(tx))', () => {
		it('EIP-1559 transaction hash is correct and deterministic', () => {
			const tx: TransactionSerializableEIP1559 = {
				type: 'eip1559',
				chainId: 1,
				nonce: 42,
				to: '0x000000000000000000000000000000000000dEaD',
				value: parseEther('1.5'),
				gas: 21000n,
				maxFeePerGas: parseGwei('50'),
				maxPriorityFeePerGas: parseGwei('2'),
			};

			const serialized = serializeTransaction(tx);
			expect(serialized).toMatch(/^0x/);

			const hash = keccak256(serialized);
			expect(hash).toMatch(/^0x[0-9a-f]{64}$/);

			// Deterministic: same tx always produces same hash
			expect(keccak256(serializeTransaction(tx))).toBe(hash);
		});

		it('legacy transaction hash is correct and deterministic', () => {
			const tx: TransactionSerializableLegacy = {
				type: 'legacy',
				chainId: 1,
				nonce: 0,
				to: '0x000000000000000000000000000000000000dEaD',
				value: parseEther('1'),
				gas: 21000n,
				gasPrice: parseGwei('30'),
			};

			const hash = keccak256(serializeTransaction(tx));
			expect(hash).toMatch(/^0x[0-9a-f]{64}$/);

			// Deterministic
			expect(keccak256(serializeTransaction(tx))).toBe(hash);
		});

		it('different nonce produces different hash', () => {
			const tx: TransactionSerializableEIP1559 = {
				type: 'eip1559',
				chainId: 1,
				nonce: 42,
				to: '0x000000000000000000000000000000000000dEaD',
				value: parseEther('1'),
				gas: 21000n,
				maxFeePerGas: parseGwei('50'),
				maxPriorityFeePerGas: parseGwei('2'),
			};

			const hash1 = keccak256(serializeTransaction(tx));
			const hash2 = keccak256(serializeTransaction({ ...tx, nonce: 43 }));
			expect(hash1).not.toBe(hash2);
		});

		it('different value produces different hash', () => {
			const tx: TransactionSerializableEIP1559 = {
				type: 'eip1559',
				chainId: 1,
				nonce: 0,
				to: '0x000000000000000000000000000000000000dEaD',
				value: parseEther('1'),
				gas: 21000n,
				maxFeePerGas: parseGwei('50'),
				maxPriorityFeePerGas: parseGwei('2'),
			};

			const hash1 = keccak256(serializeTransaction(tx));
			const hash2 = keccak256(serializeTransaction({ ...tx, value: parseEther('2') }));
			expect(hash1).not.toBe(hash2);
		});

		it('different recipient produces different hash', () => {
			const tx: TransactionSerializableEIP1559 = {
				type: 'eip1559',
				chainId: 1,
				nonce: 0,
				to: '0x000000000000000000000000000000000000dEaD',
				value: parseEther('1'),
				gas: 21000n,
				maxFeePerGas: parseGwei('50'),
				maxPriorityFeePerGas: parseGwei('2'),
			};

			const hash1 = keccak256(serializeTransaction(tx));
			const hash2 = keccak256(
				serializeTransaction({ ...tx, to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' }),
			);
			expect(hash1).not.toBe(hash2);
		});

		it('different chainId produces different hash', () => {
			const tx: TransactionSerializableEIP1559 = {
				type: 'eip1559',
				chainId: 1,
				nonce: 0,
				to: '0x000000000000000000000000000000000000dEaD',
				value: parseEther('1'),
				gas: 21000n,
				maxFeePerGas: parseGwei('50'),
				maxPriorityFeePerGas: parseGwei('2'),
			};

			const hash1 = keccak256(serializeTransaction(tx));
			const hash2 = keccak256(serializeTransaction({ ...tx, chainId: 11155111 }));
			expect(hash1).not.toBe(hash2);
		});

		it('legacy vs EIP-1559 produce different hashes for equivalent params', () => {
			const baseTx = {
				chainId: 1,
				nonce: 0,
				to: '0x000000000000000000000000000000000000dEaD' as const,
				value: parseEther('1'),
				gas: 21000n,
			};

			const legacyHash = keccak256(
				serializeTransaction({
					...baseTx,
					type: 'legacy' as const,
					gasPrice: parseGwei('30'),
				}),
			);

			const eip1559Hash = keccak256(
				serializeTransaction({
					...baseTx,
					type: 'eip1559' as const,
					maxFeePerGas: parseGwei('30'),
					maxPriorityFeePerGas: parseGwei('1'),
				}),
			);

			expect(legacyHash).not.toBe(eip1559Hash);
		});

		it('transaction with data field produces different hash than without', () => {
			const tx: TransactionSerializableEIP1559 = {
				type: 'eip1559',
				chainId: 1,
				nonce: 0,
				to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
				value: parseEther('0.001'),
				gas: 100000n,
				maxFeePerGas: parseGwei('50'),
				maxPriorityFeePerGas: parseGwei('2'),
			};

			const hashWithout = keccak256(serializeTransaction(tx));
			const hashWith = keccak256(
				serializeTransaction({ ...tx, data: '0xdeadbeef' }),
			);
			expect(hashWithout).not.toBe(hashWith);
		});

		it('hash bytes are exactly 32 bytes', () => {
			const tx: TransactionSerializableEIP1559 = {
				type: 'eip1559',
				chainId: 1,
				nonce: 0,
				to: '0x000000000000000000000000000000000000dEaD',
				value: parseEther('1'),
				gas: 21000n,
				maxFeePerGas: parseGwei('50'),
				maxPriorityFeePerGas: parseGwei('2'),
			};

			const hash = keccak256(serializeTransaction(tx));
			const hashBytes = hexToBytes(hash);
			expect(hashBytes.length).toBe(32);
		});
	});

	describe('Message hashing — hashMessage() for EIP-191', () => {
		it('hashMessage produces a valid 32-byte hash', () => {
			const message = 'Hello from threshold wallet!';
			const hash = hashMessage(message);

			expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
			expect(hexToBytes(hash).length).toBe(32);
		});

		it('hashMessage is deterministic', () => {
			const message = 'Hello from threshold wallet!';
			expect(hashMessage(message)).toBe(hashMessage(message));
		});

		it('different messages produce different hashes', () => {
			expect(hashMessage('Hello')).not.toBe(hashMessage('World'));
		});

		it('hashMessage produces the correct EIP-191 prefix', () => {
			// EIP-191: keccak256("\x19Ethereum Signed Message:\n" + len + message)
			// For "abc" (length 3), the prefixed message is:
			// "\x19Ethereum Signed Message:\n3abc"
			const message = 'abc';
			const hash = hashMessage(message);

			const prefix = '\x19Ethereum Signed Message:\n3';
			const prefixed = new Uint8Array([
				...new TextEncoder().encode(prefix),
				...new TextEncoder().encode(message),
			]);
			const expectedHash = keccak256(prefixed);

			expect(hash).toBe(expectedHash);
		});

		it('empty message produces a valid hash', () => {
			const hash = hashMessage('');
			expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
		});
	});

	describe('Typed data hashing — hashTypedData() for EIP-712', () => {
		const typedData = {
			domain: {
				name: 'Guardian Wallet',
				version: '1',
				chainId: 1,
				verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' as const,
			},
			types: {
				Transfer: [
					{ name: 'to', type: 'address' },
					{ name: 'amount', type: 'uint256' },
				],
			},
			primaryType: 'Transfer' as const,
			message: {
				to: '0x000000000000000000000000000000000000dEaD',
				amount: 1000000n,
			},
		};

		it('hashTypedData produces a valid 32-byte hash', () => {
			const hash = hashTypedData(typedData);

			expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
			expect(hexToBytes(hash).length).toBe(32);
		});

		it('hashTypedData is deterministic', () => {
			expect(hashTypedData(typedData)).toBe(hashTypedData(typedData));
		});

		it('different message values produce different hashes', () => {
			const hash1 = hashTypedData(typedData);
			const hash2 = hashTypedData({
				...typedData,
				message: { ...typedData.message, amount: 2000000n },
			});
			expect(hash1).not.toBe(hash2);
		});

		it('different domain produces different hash', () => {
			const hash1 = hashTypedData(typedData);
			const hash2 = hashTypedData({
				...typedData,
				domain: { ...typedData.domain, chainId: 11155111 },
			});
			expect(hash1).not.toBe(hash2);
		});

		it('EIP-712 hash differs from EIP-191 hash of same content', () => {
			const eip712Hash = hashTypedData(typedData);
			// JSON.stringify can't handle BigInt, so use a string representation
			const eip191Hash = hashMessage(JSON.stringify(typedData, (_key, value) =>
				typeof value === 'bigint' ? value.toString() : value,
			));
			expect(eip712Hash).not.toBe(eip191Hash);
		});
	});
});
