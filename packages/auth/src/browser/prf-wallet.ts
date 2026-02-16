import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { getAddress, keccak256 } from 'viem';
import type { PRFWalletResult } from '../shared/types.js';

const WALLET_SALT = new TextEncoder().encode('guardian-wallet-v1');
const WALLET_INFO = new TextEncoder().encode('secp256k1-key');
const ENCRYPTION_SALT = new TextEncoder().encode('guardian-share-encryption-v1');
const ENCRYPTION_INFO = new TextEncoder().encode('aes-256-gcm');

/**
 * Derive an Ethereum EOA from a WebAuthn PRF output.
 * Uses HKDF-SHA256 to stretch PRF output into a secp256k1 private key.
 */
export function deriveEOAFromPRF(prfOutput: Uint8Array): PRFWalletResult {
	const privateKey = hkdf(sha256, prfOutput, WALLET_SALT, WALLET_INFO, 32);

	// Get uncompressed public key (65 bytes: 0x04 || x || y)
	const publicKeyUncompressed = secp256k1.getPublicKey(privateKey, false);

	// keccak256 of the 64-byte public key (skip 0x04 prefix)
	const pubKeyBody = new Uint8Array(publicKeyUncompressed.buffer, 1, 64);
	const hash = keccak256(pubKeyBody);

	// Take last 20 bytes of hash as address
	const rawAddress = `0x${hash.slice(-40)}` as `0x${string}`;
	const address = getAddress(rawAddress);

	return { address, privateKey };
}

/**
 * Derive an AES-256-GCM CryptoKey from PRF output for share encryption.
 * Uses HKDF-SHA256 with a different salt/info than wallet derivation.
 * Optional per-encryption salt is concatenated with the fixed salt for domain separation.
 */
export async function deriveEncryptionKeyFromPRF(prfOutput: Uint8Array, perEncryptionSalt?: Uint8Array): Promise<CryptoKey> {
	let salt: Uint8Array;
	if (perEncryptionSalt) {
		salt = new Uint8Array(ENCRYPTION_SALT.length + perEncryptionSalt.length);
		salt.set(ENCRYPTION_SALT);
		salt.set(perEncryptionSalt, ENCRYPTION_SALT.length);
	} else {
		salt = ENCRYPTION_SALT;
	}
	const rawKey = hkdf(sha256, prfOutput, salt, ENCRYPTION_INFO, 32);
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		rawKey.buffer as ArrayBuffer,
		{ name: 'AES-GCM' },
		false,
		['encrypt', 'decrypt'],
	);
	// Wipe the raw key material
	rawKey.fill(0);
	return cryptoKey;
}

/** Zero-fill PRF output to prevent lingering in memory. */
export function wipePRF(prfOutput: Uint8Array): void {
	prfOutput.fill(0);
}

/** Zero-fill the private key inside a PRFWalletResult. */
export function wipeKey(result: PRFWalletResult): void {
	result.privateKey.fill(0);
}
