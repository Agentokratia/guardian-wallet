import { wordlist } from '@scure/bip39/wordlists/english.js';
import { describe, expect, it } from 'vitest';
import {
	decryptShareFromTransfer,
	deriveTransferKey,
	encryptShareForTransfer,
	generateTransferCode,
} from '../transfer-crypto.js';

// ---------------------------------------------------------------------------
// generateTransferCode
// ---------------------------------------------------------------------------

describe('generateTransferCode', () => {
	const transferId = 'test-transfer-001';

	it('returns exactly 6 words', () => {
		const { words } = generateTransferCode(transferId);
		expect(words).toHaveLength(6);
	});

	it('all words are valid BIP39 English words', () => {
		const wordSet = new Set(wordlist);
		const { words } = generateTransferCode(transferId);
		for (const word of words) {
			expect(wordSet.has(word)).toBe(true);
		}
	});

	it('returns a 32-byte transfer key', () => {
		const { transferKey } = generateTransferCode(transferId);
		expect(transferKey).toBeInstanceOf(Uint8Array);
		expect(transferKey.length).toBe(32);
	});

	it('different calls produce different words', () => {
		const a = generateTransferCode(transferId);
		const b = generateTransferCode(transferId);
		// 6 words from 2048 wordlist — collision probability per word is 1/2048.
		// All 6 matching is ~(1/2048)^6 ≈ 1.4e-20, effectively impossible.
		expect(a.words).not.toEqual(b.words);
	});

	it('transfer key matches deriveTransferKey with same words and transferId', () => {
		const { words, transferKey } = generateTransferCode(transferId);
		const derived = deriveTransferKey(words, transferId);
		expect(Buffer.from(transferKey).toString('hex')).toBe(Buffer.from(derived).toString('hex'));
	});
});

// ---------------------------------------------------------------------------
// deriveTransferKey
// ---------------------------------------------------------------------------

describe('deriveTransferKey', () => {
	const words = ['abandon', 'ability', 'able', 'about', 'above', 'absent'];
	const transferId = 'transfer-abc-123';

	it('is deterministic — same words + transferId produce same key', () => {
		const key1 = deriveTransferKey(words, transferId);
		const key2 = deriveTransferKey(words, transferId);
		expect(Buffer.from(key1).toString('hex')).toBe(Buffer.from(key2).toString('hex'));
	});

	it('different words produce a different key', () => {
		const altWords = ['zoo', 'zone', 'zero', 'youth', 'young', 'year'];
		const key1 = deriveTransferKey(words, transferId);
		const key2 = deriveTransferKey(altWords, transferId);
		expect(Buffer.from(key1).toString('hex')).not.toBe(Buffer.from(key2).toString('hex'));
	});

	it('different transferId produces a different key (same words)', () => {
		const key1 = deriveTransferKey(words, 'transfer-aaa');
		const key2 = deriveTransferKey(words, 'transfer-bbb');
		expect(Buffer.from(key1).toString('hex')).not.toBe(Buffer.from(key2).toString('hex'));
	});

	it('throws if word count is not 6', () => {
		expect(() => deriveTransferKey(['abandon'], transferId)).toThrowError(
			'Expected 6 words, got 1',
		);
		expect(() =>
			deriveTransferKey(
				['abandon', 'ability', 'able', 'about', 'above', 'absent', 'extra'],
				transferId,
			),
		).toThrowError('Expected 6 words, got 7');
		expect(() => deriveTransferKey([], transferId)).toThrowError('Expected 6 words, got 0');
	});

	it('throws if a word is not in the BIP39 wordlist', () => {
		const badWords = ['abandon', 'ability', 'able', 'about', 'above', 'notaword'];
		expect(() => deriveTransferKey(badWords, transferId)).toThrowError('Invalid word: "notaword"');
	});

	it('is case insensitive — lowercase and uppercase produce the same key', () => {
		const upper = words.map((w) => w.toUpperCase());
		const mixed = words.map((w, i) => (i % 2 === 0 ? w.toUpperCase() : w));
		const keyLower = deriveTransferKey(words, transferId);
		const keyUpper = deriveTransferKey(upper, transferId);
		const keyMixed = deriveTransferKey(mixed, transferId);
		const hex = Buffer.from(keyLower).toString('hex');
		expect(Buffer.from(keyUpper).toString('hex')).toBe(hex);
		expect(Buffer.from(keyMixed).toString('hex')).toBe(hex);
	});
});

// ---------------------------------------------------------------------------
// encryptShareForTransfer + decryptShareFromTransfer (round-trip)
// ---------------------------------------------------------------------------

describe('encryptShareForTransfer / decryptShareFromTransfer', () => {
	const transferId = 'roundtrip-test';

	/** Helper: generate a fresh 32-byte key for testing. */
	function makeKey(): Uint8Array {
		const { transferKey } = generateTransferCode(transferId);
		return transferKey;
	}

	it('encrypt then decrypt returns original data', async () => {
		const key = makeKey();
		const plaintext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
		const ciphertext = await encryptShareForTransfer(plaintext, key);
		const recovered = await decryptShareFromTransfer(ciphertext, key);
		expect(Buffer.from(recovered).toString('hex')).toBe(Buffer.from(plaintext).toString('hex'));
	});

	it('works with an empty Uint8Array', async () => {
		const key = makeKey();
		const plaintext = new Uint8Array(0);
		const ciphertext = await encryptShareForTransfer(plaintext, key);
		const recovered = await decryptShareFromTransfer(ciphertext, key);
		expect(recovered.length).toBe(0);
	});

	it('works with large data (1 MB)', async () => {
		const key = makeKey();
		const plaintext = new Uint8Array(1024 * 1024);
		// Fill with a deterministic pattern so we can verify round-trip
		for (let i = 0; i < plaintext.length; i++) {
			plaintext[i] = i & 0xff;
		}
		const ciphertext = await encryptShareForTransfer(plaintext, key);
		const recovered = await decryptShareFromTransfer(ciphertext, key);
		expect(recovered.length).toBe(plaintext.length);
		expect(Buffer.from(recovered).toString('hex')).toBe(Buffer.from(plaintext).toString('hex'));
	});

	it('different keys produce different ciphertext', async () => {
		const key1 = makeKey();
		const key2 = makeKey();
		const plaintext = new Uint8Array([10, 20, 30, 40]);
		const ct1 = await encryptShareForTransfer(plaintext, key1);
		const ct2 = await encryptShareForTransfer(plaintext, key2);
		// Different keys + different random IVs means ciphertexts should differ
		expect(ct1).not.toBe(ct2);
	});

	it('wrong key throws on decrypt', async () => {
		const correctKey = makeKey();
		const wrongKey = makeKey();
		const plaintext = new Uint8Array([99, 88, 77]);
		const ciphertext = await encryptShareForTransfer(plaintext, correctKey);
		await expect(decryptShareFromTransfer(ciphertext, wrongKey)).rejects.toThrowError(
			'Decryption failed',
		);
	});

	it('corrupted ciphertext throws on decrypt', async () => {
		const key = makeKey();
		const plaintext = new Uint8Array([1, 2, 3, 4]);
		const ciphertext = await encryptShareForTransfer(plaintext, key);

		// Decode, flip a byte in the ciphertext body, re-encode
		const packed = Buffer.from(ciphertext, 'base64');
		// Flip a byte past the 12-byte IV, in the ciphertext/tag region
		packed[14] = packed[14]! ^ 0xff;
		const corrupted = packed.toString('base64');

		await expect(decryptShareFromTransfer(corrupted, key)).rejects.toThrowError(
			'Decryption failed',
		);
	});

	it('truncated ciphertext (less than IV + tag) throws "Ciphertext too short"', async () => {
		const key = makeKey();
		// IV is 12 bytes, GCM tag is 16 bytes — minimum valid length is 28 bytes.
		// Provide only 20 bytes (less than 12 + 16 = 28).
		const tooShort = Buffer.from(new Uint8Array(20)).toString('base64');
		await expect(decryptShareFromTransfer(tooShort, key)).rejects.toThrowError(
			'Ciphertext too short',
		);
	});
});
