/**
 * Browser-side share file encryption.
 * Produces the same binary format as @agentokratia/guardian-signer ShareLoader:
 *   [salt — 16 bytes][iv — 12 bytes][ciphertext — variable][authTag — 16 bytes]
 *
 * Uses PBKDF2 (browser Web Crypto) instead of scrypt (Node-only).
 * The CLI ShareLoader must support both KDFs.
 */

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH = 32; // AES-256

/**
 * Encrypt a share (base64 string from DKG) with a passphrase.
 * Returns the encrypted binary as a Uint8Array in the same format as ShareLoader.
 */
export async function encryptShareForCLI(
	shareBase64: string,
	passphrase: string,
): Promise<Uint8Array> {
	const encoder = new TextEncoder();

	// The share is base64 from DKG — decode it to get the raw key material bytes,
	// then wrap it in the same JSON format ShareLoader expects
	const serialized = JSON.stringify({
		participantIndex: 1,
		scheme: 'cggmp24',
		curve: 'secp256k1',
		publicKeyBase64: '', // Will be filled by caller if needed
		dataBase64: shareBase64,
	});
	const plaintext = encoder.encode(serialized);

	// Generate salt and IV
	const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

	// Derive key with PBKDF2 (Web Crypto compatible alternative to scrypt)
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		encoder.encode(passphrase),
		'PBKDF2',
		false,
		['deriveKey'],
	);

	const key = await crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			salt,
			iterations: PBKDF2_ITERATIONS,
			hash: 'SHA-256',
		},
		keyMaterial,
		{ name: 'AES-GCM', length: KEY_LENGTH * 8 },
		false,
		['encrypt'],
	);

	// Encrypt with AES-256-GCM
	const encrypted = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, tagLength: 128 },
		key,
		plaintext,
	);

	// Web Crypto appends the auth tag to the ciphertext
	const encryptedBytes = new Uint8Array(encrypted);
	const ciphertext = encryptedBytes.slice(0, encryptedBytes.length - 16);
	const authTag = encryptedBytes.slice(encryptedBytes.length - 16);

	// Binary layout: salt | iv | ciphertext | authTag
	const result = new Uint8Array(salt.length + iv.length + ciphertext.length + authTag.length);
	result.set(salt, 0);
	result.set(iv, SALT_LENGTH);
	result.set(ciphertext, SALT_LENGTH + IV_LENGTH);
	result.set(authTag, SALT_LENGTH + IV_LENGTH + ciphertext.length);

	return result;
}
