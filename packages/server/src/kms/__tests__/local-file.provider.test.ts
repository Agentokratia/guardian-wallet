import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalFileKmsProvider } from '../local-file.provider.js';

describe('LocalFileKmsProvider', () => {
	let tempDir: string;
	let keyFilePath: string;
	let provider: LocalFileKmsProvider;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), 'kms-test-'));
		keyFilePath = join(tempDir, 'master.key');
		const masterKey = randomBytes(32).toString('hex');
		writeFileSync(keyFilePath, masterKey);
		provider = new LocalFileKmsProvider({ keyFilePath });
	});

	afterEach(async () => {
		await provider.destroy();
		try {
			unlinkSync(keyFilePath);
		} catch {
			// ignore cleanup errors
		}
	});

	it('round-trips: generateDataKey → decryptDataKey returns same plaintext', async () => {
		const { plaintextKey, encryptedKey, keyId } = await provider.generateDataKey();
		const decrypted = await provider.decryptDataKey(encryptedKey, keyId);

		expect(Buffer.from(decrypted).toString('hex')).toBe(Buffer.from(plaintextKey).toString('hex'));
		expect(plaintextKey.length).toBe(32);
		expect(keyId).toBe('local-file-master');
	});

	it('rejects wrong key file (different master key cannot decrypt)', async () => {
		const { encryptedKey, keyId } = await provider.generateDataKey();

		// Create a second provider with a different master key
		const keyFilePath2 = join(tempDir, 'master2.key');
		const differentKey = randomBytes(32).toString('hex');
		writeFileSync(keyFilePath2, differentKey);
		const provider2 = new LocalFileKmsProvider({ keyFilePath: keyFilePath2 });

		await expect(provider2.decryptDataKey(encryptedKey, keyId)).rejects.toThrow();
		await provider2.destroy();
		unlinkSync(keyFilePath2);
	});

	it('rejects invalid key length (not 32 bytes)', () => {
		const shortKeyPath = join(tempDir, 'short.key');
		writeFileSync(shortKeyPath, randomBytes(16).toString('hex'));

		expect(() => new LocalFileKmsProvider({ keyFilePath: shortKeyPath })).toThrow(
			'Master key must be 32 bytes',
		);
		unlinkSync(shortKeyPath);
	});

	it('destroy() wipes master key', async () => {
		await provider.destroy();

		// After destroy, healthCheck should return false (key zeroed)
		const healthy = await provider.healthCheck();
		expect(healthy).toBe(false);
	});

	it('healthCheck() returns true when key loaded', async () => {
		const healthy = await provider.healthCheck();
		expect(healthy).toBe(true);
	});

	it('generates unique DEKs on each call', async () => {
		const result1 = await provider.generateDataKey();
		const result2 = await provider.generateDataKey();

		// Plaintext keys should differ
		expect(Buffer.from(result1.plaintextKey).toString('hex')).not.toBe(
			Buffer.from(result2.plaintextKey).toString('hex'),
		);
		// Encrypted keys should differ (different IV)
		expect(Buffer.from(result1.encryptedKey).toString('hex')).not.toBe(
			Buffer.from(result2.encryptedKey).toString('hex'),
		);
	});
});
