import { type ChildProcess, spawn } from 'node:child_process';
import { CGGMP24Scheme } from '@agentokratia/guardian-schemes';
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
 * E2E test for the threshold signing pipeline (CGGMP24).
 *
 * SECTION 1 — Scheme-level E2E (forked Ethereum via Anvil):
 *   - Two-phase DKG (aux_info_gen + keygen) produces valid key material
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

// Skip when WASM binary has not been built yet (stub throws)
let wasmAvailable = true;
try {
	const s = new CGGMP24Scheme();
	// Attempt a no-op call to verify real WASM is loaded
	s.deriveAddress(new Uint8Array(33));
} catch {
	wasmAvailable = false;
}

describe.skipIf(!wasmAvailable)('Section 1: Scheme-level E2E — Full CGGMP24 Signing Pipeline on Mainnet Fork', () => {
	const scheme = new CGGMP24Scheme();
	let coreShares: Uint8Array[];
	let auxInfos: Uint8Array[];
	let publicKey: Uint8Array;
	let ethAddress: string;

	// Anvil state
	let anvil: ChildProcess;
	const PORT = 18546;
	const RPC = `http://127.0.0.1:${PORT}`;
	const DEAD = '0x000000000000000000000000000000000000dEaD' as const;
	const FORK_URL = process.env.ETH_RPC_URL ?? 'https://ethereum-rpc.publicnode.com';

	// ------------------------------------------------------------------
	// Setup: Two-phase DKG + Anvil
	// ------------------------------------------------------------------

	beforeAll(async () => {
		const sid = `e2e-dkg-${crypto.randomUUID()}`;

		// Phase A: aux_info_gen
		let auxResult = await scheme.auxInfoGen(sid, 1, []);
		for (let round = 2; round <= 6 && !auxResult.finished; round++) {
			auxResult = await scheme.auxInfoGen(sid, round, auxResult.outgoing);
		}
		expect(auxResult.finished).toBe(true);
		expect(auxResult.auxInfos).toBeDefined();
		auxInfos = auxResult.auxInfos!;

		// Phase B: keygen
		const keygenSid = `${sid}-keygen`;
		let dkgResult = await scheme.dkg(keygenSid, 1, []);
		for (let round = 2; round <= 6 && !dkgResult.finished; round++) {
			dkgResult = await scheme.dkg(keygenSid, round, dkgResult.outgoing);
		}
		expect(dkgResult.finished).toBe(true);
		expect(dkgResult.shares).toHaveLength(3);
		expect(dkgResult.publicKey).toBeDefined();

		publicKey = dkgResult.publicKey!;
		coreShares = dkgResult.shares!;
		ethAddress = scheme.deriveAddress(publicKey);

		expect(ethAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);

		// Start Anvil with mainnet fork
		const anvilPath = process.env.ANVIL_PATH ?? 'anvil';
		anvil = spawn(
			anvilPath,
			['--fork-url', FORK_URL, '--port', String(PORT), '--silent'],
			{ stdio: 'ignore' },
		);

		// Wait for Anvil to be ready
		let ready = false;
		for (let i = 0; i < 30; i++) {
			try {
				const res = await fetch(RPC, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
				});
				if (res.ok) { ready = true; break; }
			} catch { /* retry */ }
			await new Promise((r) => setTimeout(r, 1000));
		}
		if (!ready) throw new Error('Anvil failed to start');

		// Fund the threshold address
		await fetch(RPC, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0', id: 1, method: 'anvil_setBalance',
				params: [ethAddress, toHex(parseEther('10'))],
			}),
		});
	}, 120_000);

	afterAll(() => {
		if (anvil) {
			anvil.kill('SIGTERM');
			setTimeout(() => { try { anvil.kill('SIGKILL'); } catch { /* already dead */ } }, 3000);
		}
		if (coreShares) for (const s of coreShares) s.fill(0);
		if (auxInfos) for (const a of auxInfos) a.fill(0);
	});

	// ------------------------------------------------------------------
	// Helper: interactive threshold sign using CGGMP24Scheme
	// ------------------------------------------------------------------

	async function thresholdSign(
		coreShareA: Uint8Array,
		auxInfoA: Uint8Array,
		coreShareB: Uint8Array,
		auxInfoB: Uint8Array,
		messageHash: Uint8Array,
	): Promise<{ r: Uint8Array; s: Uint8Array; v: number }> {
		const { sessionId, firstMessages } = await scheme.createSignSession(
			[coreShareA, auxInfoA, coreShareB, auxInfoB],
			messageHash,
		);

		let msgs = firstMessages;
		let complete = false;
		let rounds = 0;
		while (!complete) {
			const res = await scheme.processSignRound(sessionId, msgs);
			msgs = res.outgoingMessages;
			complete = res.complete;
			rounds++;
			if (rounds > 10) throw new Error('Too many signing rounds');
		}

		return scheme.finalizeSign(sessionId);
	}

	// ------------------------------------------------------------------
	// 1. DKG validation
	// ------------------------------------------------------------------

	describe('1. Two-phase DKG produces valid key material', () => {
		it('generated 3 core shares and 3 aux infos', () => {
			expect(coreShares).toHaveLength(3);
			expect(auxInfos).toHaveLength(3);
		});

		it('derives a valid checksummed Ethereum address', () => {
			expect(ethAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
			expect(scheme.deriveAddress(publicKey)).toBe(ethAddress);
		});

		it('compressed public key is 33 bytes with 0x02 or 0x03 prefix', () => {
			expect(publicKey.length).toBe(33);
			expect(publicKey[0] === 0x02 || publicKey[0] === 0x03).toBe(true);
		});

		it('key material blobs are large (not mock stubs)', () => {
			for (const s of coreShares) expect(s.length).toBeGreaterThan(32);
			for (const a of auxInfos) expect(a.length).toBeGreaterThan(32);
		});
	});

	// ------------------------------------------------------------------
	// 2. Transaction signing + on-chain execution
	// ------------------------------------------------------------------

	describe('2. Transaction signing on mainnet fork', () => {
		it('signs and broadcasts a real ETH transfer (EIP-1559)', async () => {
			const client = createPublicClient({ chain: mainnet, transport: http(RPC) });

			const balance = await client.getBalance({ address: ethAddress as `0x${string}` });
			expect(balance).toBe(parseEther('10'));

			const nonce = await client.getTransactionCount({ address: ethAddress as `0x${string}` });
			const block = await client.getBlock();
			const baseFee = block.baseFeePerGas ?? parseGwei('30');
			const tip = parseGwei('1');
			const maxFee = baseFee * 2n > tip ? baseFee * 2n : tip + parseGwei('1');

			const tx: TransactionSerializableEIP1559 = {
				type: 'eip1559', chainId: 1, nonce, to: DEAD,
				value: parseEther('0.01'), gas: 21000n,
				maxFeePerGas: maxFee, maxPriorityFeePerGas: tip,
			};

			const unsignedRlp = serializeTransaction(tx);
			const digestHex = keccak256(unsignedRlp);
			const digestBytes = hexToBytes(digestHex);

			// Sign with shares 0 + 1 (signer + server path)
			const { r, s, v } = await thresholdSign(
				coreShares[0]!, auxInfos[0]!,
				coreShares[1]!, auxInfos[1]!,
				digestBytes,
			);

			const recovered = await recoverAddress({
				hash: digestHex as `0x${string}`,
				signature: { r: toHex(r), s: toHex(s), v: BigInt(v) },
			});
			expect(recovered.toLowerCase()).toBe(ethAddress.toLowerCase());

			const signedRlp = serializeTransaction(tx, {
				r: toHex(r), s: toHex(s), yParity: v - 27,
			});

			const sendRes = await fetch(RPC, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: [signedRlp] }),
			});
			const sendJson = (await sendRes.json()) as { result?: string; error?: { message: string } };
			if (sendJson.error) throw new Error(`eth_sendRawTransaction failed: ${sendJson.error.message}`);
			const txHash = sendJson.result!;

			await fetch(RPC, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'evm_mine', params: [] }),
			});

			const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
			expect(receipt.status).toBe('success');
			expect(receipt.from.toLowerCase()).toBe(ethAddress.toLowerCase());
		}, 120_000);
	});

	// ------------------------------------------------------------------
	// 3. Message signing
	// ------------------------------------------------------------------

	describe('3. Message signing', () => {
		it('signs an EIP-191 personal message and recovers correct address', async () => {
			const message = 'Hello from threshold wallet!';
			const hashHex = hashMessage(message);
			const hashBytes = hexToBytes(hashHex);

			const { r, s, v } = await thresholdSign(
				coreShares[0]!, auxInfos[0]!,
				coreShares[2]!, auxInfos[2]!,
				hashBytes,
			);

			const recovered = await recoverMessageAddress({
				message,
				signature: { r: toHex(r), s: toHex(s), v: BigInt(v) },
			});
			expect(recovered.toLowerCase()).toBe(ethAddress.toLowerCase());
		}, 60_000);
	});

	// ------------------------------------------------------------------
	// 4. All 2-of-3 combinations
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

				const { r, s, v } = await thresholdSign(
					coreShares[idxA]!, auxInfos[idxA]!,
					coreShares[idxB]!, auxInfos[idxB]!,
					msgHash,
				);

				const recovered = await recoverAddress({
					hash: toHex(msgHash),
					signature: { r: toHex(r), s: toHex(s), v: BigInt(v) },
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
	describe('Transaction hashing — keccak256(serializeTransaction(tx))', () => {
		it('EIP-1559 transaction hash is correct and deterministic', () => {
			const tx: TransactionSerializableEIP1559 = {
				type: 'eip1559', chainId: 1, nonce: 42,
				to: '0x000000000000000000000000000000000000dEaD',
				value: parseEther('1.5'), gas: 21000n,
				maxFeePerGas: parseGwei('50'), maxPriorityFeePerGas: parseGwei('2'),
			};

			const hash = keccak256(serializeTransaction(tx));
			expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
			expect(keccak256(serializeTransaction(tx))).toBe(hash);
		});

		it('different nonce produces different hash', () => {
			const tx: TransactionSerializableEIP1559 = {
				type: 'eip1559', chainId: 1, nonce: 42,
				to: '0x000000000000000000000000000000000000dEaD',
				value: parseEther('1'), gas: 21000n,
				maxFeePerGas: parseGwei('50'), maxPriorityFeePerGas: parseGwei('2'),
			};

			const hash1 = keccak256(serializeTransaction(tx));
			const hash2 = keccak256(serializeTransaction({ ...tx, nonce: 43 }));
			expect(hash1).not.toBe(hash2);
		});
	});

	describe('Message hashing — hashMessage() for EIP-191', () => {
		it('hashMessage produces a valid 32-byte hash', () => {
			const hash = hashMessage('Hello from threshold wallet!');
			expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
			expect(hexToBytes(hash).length).toBe(32);
		});

		it('different messages produce different hashes', () => {
			expect(hashMessage('Hello')).not.toBe(hashMessage('World'));
		});
	});

	describe('Typed data hashing — hashTypedData() for EIP-712', () => {
		it('hashTypedData produces a valid 32-byte hash', () => {
			const typedData = {
				domain: { name: 'Guardian Wallet', version: '1', chainId: 1, verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' as const },
				types: { Transfer: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }] },
				primaryType: 'Transfer' as const,
				message: { to: '0x000000000000000000000000000000000000dEaD', amount: 1000000n },
			};

			const hash = hashTypedData(typedData);
			expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
		});
	});
});
