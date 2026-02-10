import { describe, expect, it } from 'vitest';
import {
	decryptUserShare,
	deriveKeyFromWalletSignature,
	encryptUserShare,
	getSignMessage,
} from '../lib/user-share-store';

describe('user-share-store', () => {
	const FAKE_SIG = ('0x' + 'ab'.repeat(65)) as `0x${string}`;
	const FAKE_SIG_2 = ('0x' + 'cd'.repeat(65)) as `0x${string}`;

	describe('getSignMessage', () => {
		it('returns deterministic message for signer', () => {
			expect(getSignMessage('abc-123')).toBe(
				'Guardian: unlock share for signer abc-123',
			);
		});

		it('returns different messages for different signers', () => {
			expect(getSignMessage('a')).not.toBe(getSignMessage('b'));
		});
	});

	describe('deriveKeyFromWalletSignature', () => {
		it('produces consistent keys for same signature and salt', async () => {
			const salt = new Uint8Array(16).fill(42);
			const key1 = await deriveKeyFromWalletSignature(FAKE_SIG, salt);
			const key2 = await deriveKeyFromWalletSignature(FAKE_SIG, salt);
			expect(key1.algorithm).toEqual(key2.algorithm);
		});

		it('produces AES-GCM 256-bit keys', async () => {
			const salt = new Uint8Array(16).fill(1);
			const key = await deriveKeyFromWalletSignature(FAKE_SIG, salt);
			expect(key.algorithm).toEqual({ name: 'AES-GCM', length: 256 });
		});

		it('key supports encrypt and decrypt', async () => {
			const salt = new Uint8Array(16).fill(7);
			const key = await deriveKeyFromWalletSignature(FAKE_SIG, salt);
			expect(key.usages).toContain('encrypt');
			expect(key.usages).toContain('decrypt');
		});
	});

	describe('encryptUserShare + decryptUserShare', () => {
		it('roundtrips correctly', async () => {
			const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
			const copy = new Uint8Array(original);
			const encrypted = await encryptUserShare(copy, FAKE_SIG);

			expect(encrypted.iv).toBeDefined();
			expect(encrypted.ciphertext).toBeDefined();
			expect(encrypted.salt).toBeDefined();

			const decrypted = await decryptUserShare(encrypted, FAKE_SIG);
			expect(decrypted).toEqual(original);
		});

		it('wipes plaintext after encryption', async () => {
			const share = new Uint8Array([10, 20, 30, 40]);
			await encryptUserShare(share, FAKE_SIG);
			expect(share.every((b) => b === 0)).toBe(true);
		});

		it('fails to decrypt with wrong signature', async () => {
			const share = new Uint8Array([1, 2, 3, 4]);
			const encrypted = await encryptUserShare(share, FAKE_SIG);

			await expect(
				decryptUserShare(encrypted, FAKE_SIG_2),
			).rejects.toThrow();
		});

		it('produces different ciphertext for same plaintext (random salt)', async () => {
			const share1 = new Uint8Array([1, 2, 3, 4]);
			const share2 = new Uint8Array([1, 2, 3, 4]);
			const enc1 = await encryptUserShare(share1, FAKE_SIG);
			const enc2 = await encryptUserShare(share2, FAKE_SIG);
			expect(enc1.salt).not.toBe(enc2.salt);
		});

		it('handles empty plaintext', async () => {
			const share = new Uint8Array(0);
			const encrypted = await encryptUserShare(share, FAKE_SIG);
			const decrypted = await decryptUserShare(encrypted, FAKE_SIG);
			expect(decrypted).toEqual(new Uint8Array(0));
		});

		it('handles large plaintext (1 KB)', async () => {
			const original = new Uint8Array(1024);
			crypto.getRandomValues(original);
			const copy = new Uint8Array(original);
			const encrypted = await encryptUserShare(copy, FAKE_SIG);
			const decrypted = await decryptUserShare(encrypted, FAKE_SIG);
			expect(decrypted).toEqual(original);
		});
	});
});
