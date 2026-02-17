import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import type { CurveName, SchemeName, Share, ShareFile } from '@agentokratia/guardian-core';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** scrypt cost parameter N (2^15). */
const SCRYPT_N = 32_768;
/** scrypt block size r. */
const SCRYPT_R = 8;
/** scrypt parallelism p. */
const SCRYPT_P = 1;
/** Derived key length in bytes (AES-256). */
const KEY_LENGTH = 32;
/** Salt length in bytes. */
const SALT_LENGTH = 16;
/** AES-GCM initialisation vector length in bytes. */
const IV_LENGTH = 12;
/** AES-GCM authentication tag length in bytes. */
const AUTH_TAG_LENGTH = 16;

// ---------------------------------------------------------------------------
// Internal serialisation format for the plaintext inside the encrypted file.
// ---------------------------------------------------------------------------

interface SerializedShare {
	readonly participantIndex: 1 | 2 | 3;
	readonly scheme: SchemeName;
	readonly curve: CurveName;
	readonly publicKeyBase64: string;
	readonly dataBase64: string;
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Encrypt a {@link Share} and write it to disk as a binary `.enc` file.
 *
 * Binary layout:
 * ```
 * [salt — 16 bytes][iv — 12 bytes][ciphertext — variable][authTag — 16 bytes]
 * ```
 *
 * Key derivation uses **scrypt** (Node.js native, N=32768, r=8, p=1).
 *
 * @returns A {@link ShareFile} metadata descriptor of the written file.
 */
export async function saveShareToFile(
	share: Share,
	path: string,
	passphrase: string,
): Promise<ShareFile> {
	// 1. Serialize the Share as JSON (binary fields base64-encoded)
	const serialized: SerializedShare = {
		participantIndex: share.participantIndex,
		scheme: share.scheme,
		curve: share.curve,
		publicKeyBase64: Buffer.from(share.publicKey).toString('base64'),
		dataBase64: Buffer.from(share.data).toString('base64'),
	};
	const plaintext = Buffer.from(JSON.stringify(serialized), 'utf-8');

	// 2. Derive encryption key via scrypt
	const salt = randomBytes(SALT_LENGTH);
	const key = scryptSync(passphrase, salt, KEY_LENGTH, {
		N: SCRYPT_N,
		r: SCRYPT_R,
		p: SCRYPT_P,
		maxmem: SCRYPT_N * SCRYPT_R * 256,
	});

	// 3. Encrypt with AES-256-GCM
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const authTag = cipher.getAuthTag();

	// 4. Write binary: salt | iv | ciphertext | authTag
	const fileBuffer = Buffer.concat([salt, iv, encrypted, authTag]);
	await writeFile(path, fileBuffer);

	// 5. Zero out sensitive buffers
	plaintext.fill(0);
	key.fill(0);

	// 6. Return ShareFile metadata (matches @agentokratia/guardian-core type)
	const shareFile: ShareFile = {
		version: 1,
		encryption: {
			algorithm: 'aes-256-gcm',
			iv: iv.toString('base64'),
			tag: authTag.toString('base64'),
			kdf: 'scrypt',
			kdfParams: {
				memory: SCRYPT_N,
				iterations: SCRYPT_R,
				parallelism: SCRYPT_P,
				saltBase64: salt.toString('base64'),
			},
		},
		ciphertextBase64: encrypted.toString('base64'),
		metadata: {
			signerName: '',
			participantIndex: share.participantIndex,
			scheme: share.scheme,
			curve: share.curve,
			ethAddress: '',
			chain: 'ethereum' as never, // populated by caller
			network: 'mainnet' as never,
			createdAt: new Date().toISOString(),
		},
	};

	return shareFile;
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Read a share file from disk, either:
 * - Encrypted `.enc` binary (salt + iv + ciphertext + authTag) — requires passphrase
 * - Raw base64 string (as downloaded from the dashboard UI) — no passphrase needed
 */
export async function loadShareFromFile(path: string, passphrase: string): Promise<Share> {
	const fileBuffer = await readFile(path);

	// Try to detect if this is a raw base64 share (downloaded from UI without encryption)
	const raw = tryLoadRawBase64Share(fileBuffer);
	if (raw) return raw;

	// Otherwise, treat as encrypted binary format
	const minSize = SALT_LENGTH + IV_LENGTH + 1 + AUTH_TAG_LENGTH;
	if (fileBuffer.length < minSize) {
		throw new Error(
			`Share file too small (${fileBuffer.length} bytes). Expected at least ${minSize} bytes.`,
		);
	}

	// 1. Extract binary components
	const salt = fileBuffer.subarray(0, SALT_LENGTH);
	const iv = fileBuffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
	const ciphertext = fileBuffer.subarray(
		SALT_LENGTH + IV_LENGTH,
		fileBuffer.length - AUTH_TAG_LENGTH,
	);
	const authTag = fileBuffer.subarray(fileBuffer.length - AUTH_TAG_LENGTH);

	// 2. Derive key
	const key = scryptSync(passphrase, salt, KEY_LENGTH, {
		N: SCRYPT_N,
		r: SCRYPT_R,
		p: SCRYPT_P,
		maxmem: SCRYPT_N * SCRYPT_R * 256,
	});

	let plaintext: Buffer;
	try {
		// 3. Decrypt
		const decipher = createDecipheriv('aes-256-gcm', key, iv);
		decipher.setAuthTag(authTag);
		plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
	} catch (err: unknown) {
		throw new Error(
			`Failed to decrypt share file. Wrong passphrase or corrupted file. ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	} finally {
		key.fill(0);
	}

	// 4. Deserialize
	let serialized: SerializedShare;
	try {
		serialized = JSON.parse(plaintext.toString('utf-8')) as SerializedShare;
	} catch {
		throw new Error('Failed to parse decrypted share data. File may be corrupted.');
	} finally {
		plaintext.fill(0);
	}

	const share: Share = {
		data: new Uint8Array(Buffer.from(serialized.dataBase64, 'base64')),
		participantIndex: serialized.participantIndex,
		publicKey: new Uint8Array(Buffer.from(serialized.publicKeyBase64, 'base64')),
		scheme: serialized.scheme,
		curve: serialized.curve,
	};

	return share;
}

/**
 * Try to interpret a file buffer as a raw base64 key material string
 * (as downloaded from the dashboard UI, which writes the DKG output directly).
 * Returns null if the buffer isn't valid base64 or doesn't decode to valid JSON key material.
 */
function tryLoadRawBase64Share(fileBuffer: Buffer): Share | null {
	try {
		const text = fileBuffer.toString('utf-8').trim();
		// Base64 strings only contain [A-Za-z0-9+/=]
		if (!/^[A-Za-z0-9+/=\s]+$/.test(text)) return null;
		const data = Buffer.from(text, 'base64');
		if (data.length < 32) return null;

		// Try to parse as JSON key material { coreShare, auxInfo }
		const publicKey = new Uint8Array(0);
		try {
			const json = JSON.parse(data.toString('utf-8')) as { coreShare?: string; auxInfo?: string };
			if (!json.coreShare || !json.auxInfo) return null;
			// Valid key material format — publicKey will be derived later by the scheme
		} catch {
			// Not valid JSON key material — unsupported format
			return null;
		}

		return {
			data: new Uint8Array(data),
			participantIndex: 1,
			publicKey,
			scheme: 'cggmp24' as Share['scheme'],
			curve: 'secp256k1' as Share['curve'],
		};
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Wipe
// ---------------------------------------------------------------------------

/**
 * Zero-fill the share data in memory. Call this in a `finally` block after
 * every signing operation to uphold the core invariant.
 */
export function wipeShare(share: Share): void {
	(share.data as Uint8Array).fill(0);
	(share.publicKey as Uint8Array).fill(0);
}
