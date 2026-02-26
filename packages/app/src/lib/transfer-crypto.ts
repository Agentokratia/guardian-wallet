/**
 * Browser-compatible transfer crypto for share transfer between CLI and dashboard.
 *
 * This is the browser counterpart of `packages/wallet/src/lib/transfer-crypto.ts`.
 * Uses Web Crypto API + @noble/hashes (isomorphic) instead of Node.js `crypto`.
 *
 * Constants MUST match the Node.js version exactly:
 * - HKDF salt: 'guardian-transfer-v1'
 * - HKDF info: 'aes-256-gcm:{transferId}'
 * - 6 BIP39 words, HKDF-SHA256, AES-256-GCM with 12-byte IV
 * - Base64 format: IV (12 bytes) || ciphertext || GCM tag (16 bytes)
 */

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { wordlist } from '@scure/bip39/wordlists/english.js';

import { fromBase64, toBase64 } from './encoding';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a plain ArrayBuffer from a Uint8Array (handles subarray offsets). */
function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// Constants — must match packages/wallet/src/lib/transfer-crypto.ts exactly
// ---------------------------------------------------------------------------

const HKDF_SALT = 'guardian-transfer-v1';
const HKDF_INFO_PREFIX = 'aes-256-gcm:';
const WORD_COUNT = 6;
const AES_KEY_BYTES = 32;
const AES_IV_BYTES = 12;

// ---------------------------------------------------------------------------
// Transfer code generation & key derivation
// ---------------------------------------------------------------------------

/**
 * Generate a 6-word BIP39 transfer code and derive the corresponding AES-256-GCM key.
 *
 * Uses `crypto.getRandomValues()` for browser-compatible entropy.
 * 6 words = ~66 bits of entropy — sufficient for a 10-minute expiry window.
 */
export function generateTransferCode(transferId: string): {
	words: string[];
	transferKey: Uint8Array;
} {
	const entropy = new Uint8Array(WORD_COUNT * 2);
	crypto.getRandomValues(entropy);

	const words: string[] = [];
	for (let i = 0; i < WORD_COUNT; i++) {
		const hi = entropy[i * 2] as number;
		const lo = entropy[i * 2 + 1] as number;
		const index = ((hi << 8) | lo) % wordlist.length;
		words.push(wordlist[index] as string);
	}

	const transferKey = deriveTransferKey(words, transferId);

	// Wipe entropy
	entropy.fill(0);

	return { words, transferKey };
}

/**
 * Derive the AES-256-GCM key from 6 BIP39 words and a transfer ID.
 *
 * Uses HKDF-SHA256 with:
 * - IKM: space-joined lowercase words
 * - Salt: 'guardian-transfer-v1'
 * - Info: 'aes-256-gcm:{transferId}'
 *
 * Identical derivation to the Node.js version — same @noble/hashes library.
 */
export function deriveTransferKey(words: string[], transferId: string): Uint8Array {
	if (words.length !== WORD_COUNT) {
		throw new Error(`Expected ${WORD_COUNT} words, got ${words.length}`);
	}

	const wordSet = new Set(wordlist);
	for (const word of words) {
		if (!wordSet.has(word.toLowerCase())) {
			throw new Error(`Invalid word: "${word}". Must be a valid BIP39 word.`);
		}
	}

	const ikm = new TextEncoder().encode(words.join(' ').toLowerCase());
	const salt = new TextEncoder().encode(HKDF_SALT);
	const info = new TextEncoder().encode(`${HKDF_INFO_PREFIX}${transferId}`);

	return hkdf(sha256, ikm, salt, info, AES_KEY_BYTES);
}

// ---------------------------------------------------------------------------
// AES-256-GCM encrypt / decrypt (browser Web Crypto API)
// ---------------------------------------------------------------------------

/**
 * Encrypt share bytes with AES-256-GCM using the transfer key.
 *
 * Returns base64-encoded ciphertext: IV (12 bytes) || ciphertext || tag (16 bytes).
 */
export async function encryptShareForTransfer(
	shareBytes: Uint8Array,
	transferKey: Uint8Array,
): Promise<string> {
	const iv = new Uint8Array(AES_IV_BYTES);
	crypto.getRandomValues(iv);

	const key = await crypto.subtle.importKey(
		'raw',
		toArrayBuffer(transferKey),
		{ name: 'AES-GCM' },
		false,
		['encrypt'],
	);

	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: toArrayBuffer(iv) },
			key,
			toArrayBuffer(shareBytes),
		),
	);

	// Pack: IV || ciphertext (Web Crypto appends GCM tag to ciphertext)
	const packed = new Uint8Array(iv.length + ciphertext.length);
	packed.set(iv, 0);
	packed.set(ciphertext, iv.length);

	return toBase64(packed);
}

/**
 * Decrypt share bytes from AES-256-GCM ciphertext.
 *
 * Input: base64-encoded IV (12 bytes) || ciphertext || tag (16 bytes).
 * Throws on wrong key (GCM tag verification failure).
 */
export async function decryptShareFromTransfer(
	ciphertextBase64: string,
	transferKey: Uint8Array,
): Promise<Uint8Array> {
	const packed = fromBase64(ciphertextBase64);
	if (packed.length < AES_IV_BYTES + 16) {
		throw new Error('Ciphertext too short — expected at least IV + GCM tag');
	}

	const iv = packed.slice(0, AES_IV_BYTES);
	const ciphertext = packed.slice(AES_IV_BYTES);

	const key = await crypto.subtle.importKey(
		'raw',
		toArrayBuffer(transferKey),
		{ name: 'AES-GCM' },
		false,
		['decrypt'],
	);

	try {
		const plaintext = new Uint8Array(
			await crypto.subtle.decrypt(
				{ name: 'AES-GCM', iv: toArrayBuffer(iv) },
				key,
				toArrayBuffer(ciphertext),
			),
		);
		return plaintext;
	} catch {
		throw new Error('Decryption failed — wrong transfer code or corrupted data');
	}
}
