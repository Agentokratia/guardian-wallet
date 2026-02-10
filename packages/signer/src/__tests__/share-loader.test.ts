import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Share } from '@agentokratia/guardian-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadShareFromFile, saveShareToFile, wipeShare } from '../share-loader.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeShare(overrides: Partial<Share> = {}): Share {
	return {
		data: new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]),
		participantIndex: 1,
		publicKey: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
		scheme: 'cggmp21' as Share['scheme'],
		curve: 'secp256k1' as Share['curve'],
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('share-loader', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'share-loader-test-'));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	// -----------------------------------------------------------------------
	// Save and load roundtrip
	// -----------------------------------------------------------------------

	describe('saveShareToFile + loadShareFromFile roundtrip', () => {
		it('encrypt then decrypt returns same data', async () => {
			const share = makeShare();
			const filePath = join(tempDir, 'test.share.enc');
			const passphrase = 'correct-horse-battery-staple';

			await saveShareToFile(share, filePath, passphrase);
			const loaded = await loadShareFromFile(filePath, passphrase);

			expect(loaded.participantIndex).toBe(share.participantIndex);
			expect(loaded.scheme).toBe(share.scheme);
			expect(loaded.curve).toBe(share.curve);
			expect(Buffer.from(loaded.data)).toEqual(Buffer.from(share.data));
			expect(Buffer.from(loaded.publicKey)).toEqual(Buffer.from(share.publicKey));
		});

		it('preserves different participant indices', async () => {
			for (const idx of [1, 2, 3] as const) {
				const share = makeShare({ participantIndex: idx });
				const filePath = join(tempDir, `share-${idx}.enc`);

				await saveShareToFile(share, filePath, 'pass');
				const loaded = await loadShareFromFile(filePath, 'pass');

				expect(loaded.participantIndex).toBe(idx);
			}
		});

		it('handles large share data', async () => {
			const largeData = new Uint8Array(4096);
			for (let i = 0; i < largeData.length; i++) {
				largeData[i] = i % 256;
			}

			const share = makeShare({ data: largeData });
			const filePath = join(tempDir, 'large.share.enc');

			await saveShareToFile(share, filePath, 'pass');
			const loaded = await loadShareFromFile(filePath, 'pass');

			expect(Buffer.from(loaded.data)).toEqual(Buffer.from(largeData));
		});
	});

	// -----------------------------------------------------------------------
	// Wrong passphrase
	// -----------------------------------------------------------------------

	describe('wrong passphrase', () => {
		it('throws error when decrypting with wrong passphrase', async () => {
			const share = makeShare();
			const filePath = join(tempDir, 'test.share.enc');

			await saveShareToFile(share, filePath, 'correct-passphrase');

			await expect(
				loadShareFromFile(filePath, 'wrong-passphrase'),
			).rejects.toThrow('Failed to decrypt share file');
		});
	});

	// -----------------------------------------------------------------------
	// Corrupted file
	// -----------------------------------------------------------------------

	describe('corrupted file data', () => {
		it('throws error for file that is too small', async () => {
			const filePath = join(tempDir, 'tiny.share.enc');
			const { writeFile } = await import('node:fs/promises');
			await writeFile(filePath, new Uint8Array([1, 2, 3]));

			await expect(loadShareFromFile(filePath, 'pass')).rejects.toThrow(
				'Share file too small',
			);
		});

		it('throws error for corrupted ciphertext', async () => {
			const share = makeShare();
			const filePath = join(tempDir, 'corrupted.share.enc');

			await saveShareToFile(share, filePath, 'pass');

			// Corrupt the file by flipping bytes in the ciphertext area
			const { readFile, writeFile } = await import('node:fs/promises');
			const buf = await readFile(filePath);
			const corrupted = Buffer.from(buf);
			// Flip some bytes in the ciphertext area (after salt[16] + iv[12])
			for (let i = 28; i < 35 && i < corrupted.length - 16; i++) {
				corrupted[i] = corrupted[i]! ^ 0xff;
			}
			await writeFile(filePath, corrupted);

			await expect(loadShareFromFile(filePath, 'pass')).rejects.toThrow(
				'Failed to decrypt share file',
			);
		});
	});

	// -----------------------------------------------------------------------
	// wipeShare
	// -----------------------------------------------------------------------

	describe('wipeShare', () => {
		it('zeros the data buffer', () => {
			const share = makeShare({ data: new Uint8Array([1, 2, 3, 4]) });

			wipeShare(share);

			expect(share.data.every((b) => b === 0)).toBe(true);
		});

		it('zeros the publicKey buffer', () => {
			const share = makeShare({ publicKey: new Uint8Array([5, 6, 7, 8]) });

			wipeShare(share);

			expect(share.publicKey.every((b) => b === 0)).toBe(true);
		});

		it('zeros both buffers simultaneously', () => {
			const data = new Uint8Array([1, 2, 3]);
			const publicKey = new Uint8Array([4, 5, 6]);
			const share = makeShare({ data, publicKey });

			wipeShare(share);

			expect(data.every((b) => b === 0)).toBe(true);
			expect(publicKey.every((b) => b === 0)).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// saveShareToFile metadata
	// -----------------------------------------------------------------------

	describe('saveShareToFile returns ShareFile metadata', () => {
		it('returns correct metadata structure', async () => {
			const share = makeShare();
			const filePath = join(tempDir, 'meta.share.enc');

			const shareFile = await saveShareToFile(share, filePath, 'pass');

			expect(shareFile.version).toBe(1);
			expect(shareFile.encryption.algorithm).toBe('aes-256-gcm');
			expect(shareFile.encryption.kdf).toBe('scrypt');
			expect(shareFile.metadata.participantIndex).toBe(share.participantIndex);
			expect(shareFile.metadata.scheme).toBe(share.scheme);
			expect(shareFile.metadata.curve).toBe(share.curve);
		});
	});
});
