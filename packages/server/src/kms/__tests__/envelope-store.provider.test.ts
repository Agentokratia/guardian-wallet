import { randomBytes } from 'node:crypto';
import { mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvelopeStoreProvider } from '../envelope-store.provider.js';
import { LocalFileKmsProvider } from '../local-file.provider.js';

/**
 * In-memory mock of the Supabase client for testing.
 * Only implements the query chain methods used by EnvelopeStoreProvider.
 */
function createMockSupabase() {
	const store = new Map<string, unknown>();

	const client = {
		from: (table: string) => {
			if (table !== 'encrypted_shares') {
				throw new Error(`Unexpected table: ${table}`);
			}

			return {
				upsert: (row: { path: string; envelope: unknown; updated_at: string }, _opts: unknown) => {
					store.set(row.path, { path: row.path, envelope: row.envelope });
					return { error: null };
				},
				select: (columns: string) => ({
					eq: (col: string, val: string) => ({
						single: () => {
							const row = store.get(val);
							if (!row) return { data: null, error: { message: 'Not found' } };
							return { data: row, error: null };
						},
					}),
					limit: (_n: number) => {
						return { error: null };
					},
				}),
				delete: () => ({
					eq: (_col: string, val: string) => {
						store.delete(val);
						return { error: null };
					},
				}),
			};
		},
		_store: store,
	};

	return client;
}

describe('EnvelopeStoreProvider', () => {
	let tempDir: string;
	let keyFilePath: string;
	let kms: LocalFileKmsProvider;
	let mockSupabase: ReturnType<typeof createMockSupabase>;
	let provider: EnvelopeStoreProvider;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), 'envelope-test-'));
		keyFilePath = join(tempDir, 'master.key');
		const masterKey = randomBytes(32).toString('hex');
		writeFileSync(keyFilePath, masterKey);
		kms = new LocalFileKmsProvider({ keyFilePath });
		mockSupabase = createMockSupabase();
		provider = new EnvelopeStoreProvider(kms, mockSupabase as never);
	});

	afterEach(async () => {
		await kms.destroy();
		try {
			unlinkSync(keyFilePath);
		} catch {
			// ignore
		}
	});

	it('storeShare + getShare round-trip returns identical bytes', async () => {
		const share = randomBytes(128);
		const path = 'signers/test-signer/server';

		await provider.storeShare(path, new Uint8Array(share));
		const result = await provider.getShare(path);

		expect(Buffer.from(result).toString('hex')).toBe(share.toString('hex'));
	});

	it('DEK wiped after storeShare', async () => {
		const share = randomBytes(64);
		const path = 'signers/dek-wipe-test/server';

		// Spy on generateDataKey to capture the plaintextKey reference
		const origGenerate = kms.generateDataKey.bind(kms);
		let capturedKey: Uint8Array | undefined;
		vi.spyOn(kms, 'generateDataKey').mockImplementation(async () => {
			const result = await origGenerate();
			capturedKey = result.plaintextKey;
			return result;
		});

		await provider.storeShare(path, new Uint8Array(share));

		expect(capturedKey).toBeDefined();
		// The key buffer should be zeroed after storeShare
		const allZero = (capturedKey as Uint8Array).every((b) => b === 0);
		expect(allZero).toBe(true);
	});

	it('DEK wiped after getShare', async () => {
		const share = randomBytes(64);
		const path = 'signers/dek-wipe-get/server';
		await provider.storeShare(path, new Uint8Array(share));

		// Spy on decryptDataKey to capture the returned key
		const origDecrypt = kms.decryptDataKey.bind(kms);
		let capturedKey: Uint8Array | undefined;
		vi.spyOn(kms, 'decryptDataKey').mockImplementation(async (ek, kid) => {
			const result = await origDecrypt(ek, kid);
			capturedKey = result;
			return result;
		});

		await provider.getShare(path);

		expect(capturedKey).toBeDefined();
		const allZero = (capturedKey as Uint8Array).every((b) => b === 0);
		expect(allZero).toBe(true);
	});

	it('deleteShare removes from DB', async () => {
		const share = randomBytes(64);
		const path = 'signers/delete-test/server';

		await provider.storeShare(path, new Uint8Array(share));
		await provider.deleteShare(path);

		await expect(provider.getShare(path)).rejects.toThrow('Share not found');
	});

	it('getShare throws on missing path', async () => {
		await expect(provider.getShare('nonexistent/path')).rejects.toThrow('Share not found');
	});

	it('healthCheck returns true when KMS and DB are healthy', async () => {
		const healthy = await provider.healthCheck();
		expect(healthy).toBe(true);
	});

	it('healthCheck returns false when KMS is unhealthy', async () => {
		await kms.destroy(); // Wipes master key → healthCheck returns false
		const healthy = await provider.healthCheck();
		expect(healthy).toBe(false);
	});

	it('AAD binding: share stored at path-A cannot be read with path-B', async () => {
		const share = randomBytes(64);
		const pathA = 'signers/aad-test-a/server';
		const pathB = 'signers/aad-test-b/server';

		await provider.storeShare(pathA, new Uint8Array(share));

		// Simulate attacker moving the row: copy envelope from path-A to path-B in DB
		const rowA = mockSupabase._store.get(pathA) as { envelope: unknown };
		mockSupabase._store.set(pathB, { path: pathB, envelope: rowA.envelope });

		// Decryption should fail because AAD (path) doesn't match
		await expect(provider.getShare(pathB)).rejects.toThrow();
	});

	it('handles large share data', async () => {
		const largeShare = randomBytes(4096);
		const path = 'signers/large-share/server';

		await provider.storeShare(path, new Uint8Array(largeShare));
		const result = await provider.getShare(path);

		expect(Buffer.from(result).toString('hex')).toBe(largeShare.toString('hex'));
	});

	it('DEK wiped even when DB write fails', async () => {
		const share = randomBytes(64);
		const path = 'signers/db-fail-test/server';

		// Make DB upsert fail
		const origFrom = mockSupabase.from.bind(mockSupabase);
		vi.spyOn(mockSupabase, 'from').mockImplementation((table: string) => {
			const chain = origFrom(table);
			chain.upsert = () => ({ error: { message: 'DB connection lost' } as never });
			return chain;
		});

		const origGenerate = kms.generateDataKey.bind(kms);
		let capturedKey: Uint8Array | undefined;
		vi.spyOn(kms, 'generateDataKey').mockImplementation(async () => {
			const result = await origGenerate();
			capturedKey = result.plaintextKey;
			return result;
		});

		await expect(provider.storeShare(path, new Uint8Array(share))).rejects.toThrow(
			'Failed to store encrypted share',
		);

		expect(capturedKey).toBeDefined();
		const allZero = (capturedKey as Uint8Array).every((b) => b === 0);
		expect(allZero).toBe(true);
	});

	it('envelope stored in DB has expected structure', async () => {
		const share = randomBytes(64);
		const path = 'signers/structure-test/server';

		await provider.storeShare(path, new Uint8Array(share));

		const row = mockSupabase._store.get(path) as { envelope: Record<string, unknown> };
		const envelope = row.envelope;

		expect(envelope.version).toBe(1);
		expect(envelope.algorithm).toBe('aes-256-gcm');
		expect(envelope.keyId).toBe('local-file-master');
		expect(envelope.aadPath).toBe(path);
		expect(typeof envelope.encryptedDek).toBe('string');
		expect(typeof envelope.iv).toBe('string');
		expect(typeof envelope.ciphertext).toBe('string');
		expect(typeof envelope.authTag).toBe('string');
	});
});
