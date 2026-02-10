/**
 * User Share Store -- Wallet signature-based encryption (no IndexedDB, no passphrase).
 *
 * The user keyshare is encrypted with an AES-256-GCM key derived from a
 * deterministic wallet signature via HKDF. The encrypted blob is stored
 * server-side. Only the wallet owner can decrypt it by re-signing the
 * same deterministic message.
 *
 * Security properties:
 * - User share NEVER stored in plaintext on any server
 * - Encryption key is derived from a wallet signature (HKDF + AES-256-GCM)
 * - Only the wallet owner can produce the signature to decrypt
 * - Per-signer message ensures different encryption contexts per signer
 */

import { fromBase64, toBase64 } from './encoding';

const SIGN_MESSAGE_PREFIX = 'Guardian: unlock share for signer';

export function getSignMessage(signerId: string): string {
	return `${SIGN_MESSAGE_PREFIX} ${signerId}`;
}

function hexToBytes(hex: string): Uint8Array {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
	const bytes = new Uint8Array(clean.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

export async function deriveKeyFromWalletSignature(
	signature: `0x${string}`,
	salt: Uint8Array,
): Promise<CryptoKey> {
	const sigBytes = hexToBytes(signature);
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		sigBytes.buffer as ArrayBuffer,
		'HKDF',
		false,
		['deriveKey'],
	);
	return crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: salt.buffer as ArrayBuffer,
			info: new TextEncoder().encode('guardian-share-encryption'),
		},
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
}

export async function encryptUserShare(
	shareBytes: Uint8Array,
	signature: `0x${string}`,
): Promise<{ iv: string; ciphertext: string; salt: string }> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveKeyFromWalletSignature(signature, salt);
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
	signature: `0x${string}`,
): Promise<Uint8Array> {
	const iv = fromBase64(encrypted.iv);
	const ciphertext = fromBase64(encrypted.ciphertext);
	const salt = fromBase64(encrypted.salt);
	const key = await deriveKeyFromWalletSignature(signature, salt);
	const plaintext = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
		key,
		ciphertext.buffer as ArrayBuffer,
	);
	return new Uint8Array(plaintext);
}
