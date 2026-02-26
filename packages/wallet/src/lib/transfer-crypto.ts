import { randomBytes } from 'node:crypto';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { wordlist } from '@scure/bip39/wordlists/english.js';

// ---------------------------------------------------------------------------
// Constants
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
 * The words are randomly chosen from the BIP39 English wordlist (2048 words).
 * 6 words = ~66 bits of entropy — sufficient for a 10-minute expiry window.
 *
 * The AES key is derived via HKDF-SHA256 with a fixed salt and transfer-specific info,
 * binding the key to a specific transfer ID to prevent cross-transfer reuse.
 */
export function generateTransferCode(transferId: string): {
	words: string[];
	transferKey: Uint8Array;
} {
	const entropy = randomBytes(WORD_COUNT * 2); // 2 bytes per word → 0..65535 mod 2048
	const words: string[] = [];

	for (let i = 0; i < WORD_COUNT; i++) {
		const hi = entropy[i * 2] as number;
		const lo = entropy[i * 2 + 1] as number;
		const index = ((hi << 8) | lo) % wordlist.length;
		words.push(wordlist[index] as string);
	}

	const transferKey = deriveTransferKey(words, transferId);
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
 */
export function deriveTransferKey(words: string[], transferId: string): Uint8Array {
	if (words.length !== WORD_COUNT) {
		throw new Error(`Expected ${WORD_COUNT} words, got ${words.length}`);
	}

	// Validate all words are in the BIP39 wordlist
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
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract a plain ArrayBuffer from a Uint8Array (handles Buffer subarrays). */
function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// AES-256-GCM encrypt / decrypt
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
	const iv = randomBytes(AES_IV_BYTES);
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

	// Pack: IV || ciphertext (includes GCM tag)
	const packed = new Uint8Array(iv.length + ciphertext.length);
	packed.set(iv, 0);
	packed.set(ciphertext, iv.length);

	return Buffer.from(packed).toString('base64');
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
	const packed = Buffer.from(ciphertextBase64, 'base64');
	if (packed.length < AES_IV_BYTES + 16) {
		throw new Error('Ciphertext too short — expected at least IV + GCM tag');
	}

	const iv = packed.subarray(0, AES_IV_BYTES);
	const ciphertext = packed.subarray(AES_IV_BYTES);

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
