/**
 * User Share Store -- PRF-based encryption (replaces wallet signature).
 *
 * The user keyshare is encrypted with an AES-256-GCM key derived from
 * the WebAuthn PRF output via HKDF. The encrypted blob is stored
 * server-side. Only the passkey owner can reproduce the PRF output
 * needed to decrypt.
 *
 * Security properties:
 * - User share NEVER stored in plaintext on any server
 * - Encryption key is derived from PRF output (HKDF + AES-256-GCM)
 * - Only the passkey owner can produce the PRF output to decrypt
 * - Per-signer salt ensures different encryption contexts per signer
 */

import { deriveEncryptionKeyFromPRF } from '@agentokratia/guardian-auth/browser';
import { fromBase64, toBase64 } from './encoding';

export async function encryptUserShare(
	shareBytes: Uint8Array,
	prfOutput: Uint8Array,
): Promise<{ iv: string; ciphertext: string; salt: string }> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveEncryptionKeyFromPRF(prfOutput, salt);
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
		key,
		shareBytes.buffer as ArrayBuffer,
	);
	// Wipe plaintext
	shareBytes.fill(0);
	return {
		iv: toBase64(iv),
		ciphertext: toBase64(new Uint8Array(ciphertext)),
		salt: toBase64(salt),
	};
}

export async function decryptUserShare(
	encrypted: { iv: string; ciphertext: string; salt: string },
	prfOutput: Uint8Array,
): Promise<Uint8Array> {
	const iv = fromBase64(encrypted.iv);
	const ciphertext = fromBase64(encrypted.ciphertext);
	const salt = fromBase64(encrypted.salt);
	const key = await deriveEncryptionKeyFromPRF(prfOutput, salt);
	const plaintext = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
		key,
		ciphertext.buffer as ArrayBuffer,
	);
	return new Uint8Array(plaintext);
}
