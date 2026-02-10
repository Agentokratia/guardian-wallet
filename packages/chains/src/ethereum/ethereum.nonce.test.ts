import { describe, expect, it } from 'vitest';
import { EthereumNonceManager } from './ethereum.nonce.js';

describe('EthereumNonceManager', () => {
	const address = '0x1234567890abcdef1234567890abcdef12345678';

	it('fetches initial nonce from chain', async () => {
		const manager = new EthereumNonceManager(async () => 5);
		const nonce = await manager.getNext(address);
		expect(nonce).toBe(5);
	});

	it('increments nonce on subsequent calls', async () => {
		const manager = new EthereumNonceManager(async () => 0);
		const n1 = await manager.getNext(address);
		const n2 = await manager.getNext(address);
		const n3 = await manager.getNext(address);
		expect(n1).toBe(0);
		expect(n2).toBe(1);
		expect(n3).toBe(2);
	});

	it('normalizes address to lowercase', async () => {
		const manager = new EthereumNonceManager(async () => 10);
		const upper = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12';
		const n1 = await manager.getNext(upper);
		const n2 = await manager.getNext(upper.toLowerCase());
		expect(n1).toBe(10);
		expect(n2).toBe(11);
	});

	it('re-fetches from chain after release', async () => {
		// Chain says nonce 0 (nothing mined yet)
		const manager = new EthereumNonceManager(async () => 0);
		const n1 = await manager.getNext(address);
		expect(n1).toBe(0);

		// Release nonce 0 (tx failed) — clears cache, re-fetch from chain
		await manager.release(address, 0);

		// Chain still says 0 → re-issue 0
		const n2 = await manager.getNext(address);
		expect(n2).toBe(0);
	});

	it('skips in-flight nonces after release and re-fetch', async () => {
		// Chain says 0. Issue 0, 1, 2 → reserved={0,1,2}
		const manager = new EthereumNonceManager(async () => 0);
		const n0 = await manager.getNext(address);
		const n1 = await manager.getNext(address);
		const n2 = await manager.getNext(address);
		expect(n0).toBe(0);
		expect(n1).toBe(1);
		expect(n2).toBe(2);

		// Release nonce 1 (tx failed) → reserved={0,2}, cache cleared
		await manager.release(address, 1);

		// Re-fetch from chain (still 0), skip 0 (reserved), land on 1
		const reused = await manager.getNext(address);
		expect(reused).toBe(1);

		// Now reserved={0,1,2}, counter=2, skip 2 (reserved) → 3
		const next = await manager.getNext(address);
		expect(next).toBe(3);
	});

	it('handles multiple releases — fills gaps from chain', async () => {
		// Chain says 0. Issue 0,1,2,3 → reserved={0,1,2,3}
		const manager = new EthereumNonceManager(async () => 0);
		await manager.getNext(address); // 0
		await manager.getNext(address); // 1
		await manager.getNext(address); // 2
		await manager.getNext(address); // 3

		// Release 2 then 0 → reserved={1,3}
		await manager.release(address, 2);
		await manager.release(address, 0);

		// Re-fetch from chain (0), not reserved → issue 0
		expect(await manager.getNext(address)).toBe(0);
		// counter=1, skip 1 (reserved), try 2 → issue 2
		expect(await manager.getNext(address)).toBe(2);
		// counter=3, skip 3 (reserved), try 4 → issue 4
		expect(await manager.getNext(address)).toBe(4);
	});

	it('re-fetches updated chain nonce after txs mine', async () => {
		// Simulate: chain nonce advances as txs mine
		let chainNonce = 0;
		const manager = new EthereumNonceManager(async () => chainNonce);

		// Issue 0, 1, 2
		expect(await manager.getNext(address)).toBe(0);
		expect(await manager.getNext(address)).toBe(1);
		expect(await manager.getNext(address)).toBe(2);

		// Tx 0 and 1 mine → chain advances to 2
		chainNonce = 2;

		// Release nonce 2 (tx failed) → cache cleared
		await manager.release(address, 2);

		// Re-fetch from chain (now 2), not reserved → issue 2
		expect(await manager.getNext(address)).toBe(2);
	});

	it('handles concurrent nonce allocation without conflicts', async () => {
		const manager = new EthereumNonceManager(async () => 0);
		const nonces = await Promise.all([
			manager.getNext(address),
			manager.getNext(address),
			manager.getNext(address),
		]);
		const unique = new Set(nonces);
		expect(unique.size).toBe(3);
	});
});
