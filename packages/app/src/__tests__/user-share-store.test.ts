import { describe, expect, it, vi } from 'vitest';
import {
	decryptUserShare,
	encryptUserShare,
} from '../lib/user-share-store';

// Mock the auth package's deriveEncryptionKeyFromPRF
vi.mock('@agentokratia/guardian-auth/browser', () => ({
	deriveEncryptionKeyFromPRF: async (_prfOutput: Uint8Array) => {
		// Derive a deterministic AES-GCM key from the PRF output for testing
		const keyMaterial = await crypto.subtle.importKey(
			'raw',
			_prfOutput.buffer as ArrayBuffer,
			'HKDF',
			false,
			['deriveKey'],
		);
		return crypto.subtle.deriveKey(
			{ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(16).buffer as ArrayBuffer, info: new Uint8Array(0).buffer as ArrayBuffer },
			keyMaterial,
			{ name: 'AES-GCM', length: 256 },
			false,
			['encrypt', 'decrypt'],
		);
	},
}));

describe('user-share-store (PRF-based)', () => {
	const FAKE_PRF = new Uint8Array(32).fill(0xab);
	const FAKE_PRF_2 = new Uint8Array(32).fill(0xcd);

	describe('encryptUserShare + decryptUserShare', () => {
		it('roundtrips correctly', async () => {
			const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
			const copy = new Uint8Array(original);
			const encrypted = await encryptUserShare(copy, FAKE_PRF);

			expect(encrypted.iv).toBeDefined();
			expect(encrypted.ciphertext).toBeDefined();
			expect(encrypted.salt).toBeDefined();

			const decrypted = await decryptUserShare(encrypted, FAKE_PRF);
			expect(decrypted).toEqual(original);
		});

		it('wipes plaintext after encryption', async () => {
			const share = new Uint8Array([10, 20, 30, 40]);
			await encryptUserShare(share, FAKE_PRF);
			expect(share.every((b) => b === 0)).toBe(true);
		});

		it('fails to decrypt with wrong PRF output', async () => {
			const share = new Uint8Array([1, 2, 3, 4]);
			const encrypted = await encryptUserShare(share, FAKE_PRF);

			await expect(
				decryptUserShare(encrypted, FAKE_PRF_2),
			).rejects.toThrow();
		});

		it('produces different ciphertext for same plaintext (random salt/iv)', async () => {
			const share1 = new Uint8Array([1, 2, 3, 4]);
			const share2 = new Uint8Array([1, 2, 3, 4]);
			const enc1 = await encryptUserShare(share1, FAKE_PRF);
			const enc2 = await encryptUserShare(share2, FAKE_PRF);
			expect(enc1.salt).not.toBe(enc2.salt);
		});

		it('handles empty plaintext', async () => {
			const share = new Uint8Array(0);
			const encrypted = await encryptUserShare(share, FAKE_PRF);
			const decrypted = await decryptUserShare(encrypted, FAKE_PRF);
			expect(decrypted).toEqual(new Uint8Array(0));
		});

		it('handles large plaintext (1 KB)', async () => {
			const original = new Uint8Array(1024);
			crypto.getRandomValues(original);
			const copy = new Uint8Array(original);
			const encrypted = await encryptUserShare(copy, FAKE_PRF);
			const decrypted = await decryptUserShare(encrypted, FAKE_PRF);
			expect(decrypted).toEqual(original);
		});
	});
});
