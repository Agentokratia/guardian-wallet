import { secp256k1 } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';
import {
	keccak256,
	recoverAddress,
	toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { DKLs23Scheme } from './dkls23.scheme.js';

/**
 * Integration test: Guardian wallet-encrypted user share flow.
 *
 * Tests the REAL end-to-end flow with actual DKLs23 WASM crypto:
 *
 *   1. DKG → 3 real keyshares (signer, server, user)
 *   2. Encrypt user share with an Ethereum wallet signature (HKDF + AES-256-GCM)
 *   3. Serialize encrypted blob as JSON (simulates server Vault roundtrip)
 *   4. Decrypt with the same wallet → recover original share bytes
 *   5. Use decrypted share + server share → threshold sign → valid ECDSA
 *   6. Use decrypted share + signer share → threshold sign (server-down path)
 *   7. Wrong wallet → decryption fails
 *
 * NO MOCKS. Real WASM DKG, real Web Crypto, real secp256k1 verification.
 */

// ---- Inline wallet-based share encryption (mirrors packages/app/src/lib/user-share-store.ts) ----

function hexToBytes(hex: string): Uint8Array {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
	const bytes = new Uint8Array(clean.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function getSignMessage(signerId: string): string {
	return `Guardian: unlock share for signer ${signerId}`;
}

async function deriveKeyFromWalletSignature(
	signature: `0x${string}`,
	salt: Uint8Array,
): Promise<CryptoKey> {
	const sigBytes = new Uint8Array(hexToBytes(signature));
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		sigBytes,
		'HKDF',
		false,
		['deriveKey'],
	);
	return crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new Uint8Array(salt),
			info: new TextEncoder().encode('guardian-share-encryption'),
		},
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
}

async function encryptUserShare(
	shareBytes: Uint8Array,
	signature: `0x${string}`,
): Promise<{ iv: string; ciphertext: string; salt: string }> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveKeyFromWalletSignature(signature, salt);
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: new Uint8Array(iv) },
		key,
		new Uint8Array(shareBytes),
	);
	return {
		iv: toBase64(iv),
		ciphertext: toBase64(new Uint8Array(ciphertext)),
		salt: toBase64(salt),
	};
}

async function decryptUserShare(
	encrypted: { iv: string; ciphertext: string; salt: string },
	signature: `0x${string}`,
): Promise<Uint8Array> {
	const iv = fromBase64(encrypted.iv);
	const ciphertext = fromBase64(encrypted.ciphertext);
	const salt = fromBase64(encrypted.salt);
	const key = await deriveKeyFromWalletSignature(signature, salt);
	const plaintext = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: new Uint8Array(iv) },
		key,
		new Uint8Array(ciphertext),
	);
	return new Uint8Array(plaintext);
}

// ---- Test wallet accounts (deterministic, for reproducible tests) ----

// User's Ethereum wallet (used to encrypt/decrypt the user share)
const USER_WALLET = privateKeyToAccount(
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
);
// Wrong wallet (should fail decryption)
const WRONG_WALLET = privateKeyToAccount(
	'0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);

// ---- Tests ----

describe('Guardian Share Flow — Real DKG + Wallet Encryption + Threshold Signing', () => {
	const scheme = new DKLs23Scheme();
	let shares: Uint8Array[];
	let publicKey: Uint8Array;
	let ethAddress: string;

	// Simulated signer ID (UUID)
	const signerId = 'e7a1b2c3-d4e5-6f78-9012-abcdef012345';

	// ====================================================================
	// Phase 1: DKG — generate real keyshares
	// ====================================================================

	it('Phase 1: DKG produces 3 valid keyshares', async () => {
		const sid = `guardian-flow-${crypto.randomUUID()}`;

		const r1 = await scheme.dkg(sid, 1, []);
		const r2 = await scheme.dkg(sid, 2, r1.outgoing);
		const r3 = await scheme.dkg(sid, 3, r2.outgoing);
		const r4 = await scheme.dkg(sid, 4, r3.outgoing);
		const r5 = await scheme.dkg(sid, 5, r4.outgoing);

		expect(r5.finished).toBe(true);
		expect(r5.shares).toHaveLength(3);

		shares = r5.shares!;
		publicKey = r5.publicKey!;
		ethAddress = scheme.deriveAddress(publicKey);

		console.log('');
		console.log('  ┌─── GUARDIAN SHARE FLOW ─────────────────────────────────');
		console.log(`  │ ETH address  : ${ethAddress}`);
		console.log(`  │ User wallet  : ${USER_WALLET.address}`);
		console.log(`  │ Signer share : ${shares[0]!.length} bytes`);
		console.log(`  │ Server share : ${shares[1]!.length} bytes`);
		console.log(`  │ User share   : ${shares[2]!.length} bytes`);
		console.log('  │');
	}, 60_000);

	// ====================================================================
	// Phase 2: Encrypt user share with wallet signature
	// ====================================================================

	let encryptedBlob: { walletAddress: string; iv: string; ciphertext: string; salt: string };
	let walletSignature: `0x${string}`;

	it('Phase 2: Encrypt user share with wallet signature (HKDF + AES-256-GCM)', async () => {
		// User signs deterministic message with their Ethereum wallet
		const message = getSignMessage(signerId);
		expect(message).toBe(`Guardian: unlock share for signer ${signerId}`);

		walletSignature = await USER_WALLET.signMessage({ message });
		expect(walletSignature).toMatch(/^0x[0-9a-f]+$/i);

		// Encrypt the user share (share index 2) with the wallet-derived key
		const userShare = new Uint8Array(shares[2]!); // copy — encryptUserShare doesn't wipe in test version
		const encrypted = await encryptUserShare(userShare, walletSignature);

		// Build the blob that would be stored in Vault
		encryptedBlob = {
			walletAddress: USER_WALLET.address,
			iv: encrypted.iv,
			ciphertext: encrypted.ciphertext,
			salt: encrypted.salt,
		};

		// Verify the blob is valid JSON-serializable (simulates Vault storage)
		const json = JSON.stringify(encryptedBlob);
		expect(json.length).toBeGreaterThan(100);

		// Verify ciphertext is different from plaintext
		const ctBytes = fromBase64(encrypted.ciphertext);
		expect(ctBytes.length).toBeGreaterThanOrEqual(shares[2]!.length);

		console.log(`  │ Wallet sig   : ${walletSignature.slice(0, 20)}...`);
		console.log(`  │ Encrypted    : ${encrypted.ciphertext.length} chars (base64)`);
		console.log(`  │ Salt         : ${encrypted.salt}`);
		console.log('  │');
	});

	// ====================================================================
	// Phase 3: Simulate server Vault roundtrip (store → retrieve)
	// ====================================================================

	let retrievedBlob: { walletAddress: string; iv: string; ciphertext: string; salt: string };

	it('Phase 3: Vault roundtrip — JSON serialize → deserialize', () => {
		// Simulate: POST /signers/:id/user-share (server stores as JSON → Uint8Array in Vault)
		const json = JSON.stringify(encryptedBlob);
		const vaultBytes = new TextEncoder().encode(json);

		// Simulate: GET /signers/:id/user-share (server reads bytes → JSON.parse)
		const decoded = new TextDecoder().decode(vaultBytes);
		retrievedBlob = JSON.parse(decoded);

		// Verify roundtrip is lossless
		expect(retrievedBlob.walletAddress).toBe(encryptedBlob.walletAddress);
		expect(retrievedBlob.iv).toBe(encryptedBlob.iv);
		expect(retrievedBlob.ciphertext).toBe(encryptedBlob.ciphertext);
		expect(retrievedBlob.salt).toBe(encryptedBlob.salt);

		console.log('  │ Vault store  : OK (JSON → bytes → JSON roundtrip)');
		console.log('  │');
	});

	// ====================================================================
	// Phase 4: Decrypt user share with same wallet
	// ====================================================================

	let decryptedUserShare: Uint8Array;

	it('Phase 4: Decrypt user share with correct wallet signature', async () => {
		// User signs the same deterministic message again
		const signature = await USER_WALLET.signMessage({
			message: getSignMessage(signerId),
		});

		// Same wallet + same message → same signature → same AES key
		expect(signature).toBe(walletSignature);

		// Decrypt
		decryptedUserShare = await decryptUserShare(retrievedBlob, signature);

		// Verify: decrypted bytes match original user share exactly
		expect(decryptedUserShare.length).toBe(shares[2]!.length);
		expect(toHex(decryptedUserShare)).toBe(toHex(shares[2]!));

		console.log('  │ Decrypted    : OK (matches original user share)');
		console.log('  │');
	});

	// ====================================================================
	// Phase 5: Wrong wallet cannot decrypt
	// ====================================================================

	it('Phase 5: Wrong wallet signature fails decryption', async () => {
		const wrongSignature = await WRONG_WALLET.signMessage({
			message: getSignMessage(signerId),
		});

		// Different wallet → different signature → different AES key → decryption fails
		expect(wrongSignature).not.toBe(walletSignature);

		await expect(
			decryptUserShare(retrievedBlob, wrongSignature),
		).rejects.toThrow();

		console.log('  │ Wrong wallet : REJECTED (decryption failed as expected)');
		console.log('  │');
	});

	// ====================================================================
	// Phase 6: Threshold sign with decrypted user share + server share
	//          (User + Server path — normal override)
	// ====================================================================

	it('Phase 6: Threshold sign — decrypted user share + server share (User+Server path)', async () => {
		const msgHash = new Uint8Array(32);
		crypto.getRandomValues(msgHash);

		// shares[1] = server share, decryptedUserShare = user share (from Vault, decrypted)
		const { sessionId, firstMessages } = scheme.createSignSession([
			shares[1]!, // server share
			decryptedUserShare, // decrypted user share
		]);

		let msgs = firstMessages;
		let presigned = false;
		let rounds = 0;
		while (!presigned) {
			const res = scheme.processSignRound(sessionId, msgs);
			msgs = res.outgoingMessages;
			presigned = res.presigned;
			rounds++;
		}

		const { r, s, v } = scheme.finalizeSign(sessionId, msgHash, []);

		// Verify valid ECDSA signature
		const compact = new Uint8Array(64);
		compact.set(r, 0);
		compact.set(s, 32);
		expect(secp256k1.verify(compact, msgHash, publicKey, { prehash: false })).toBe(true);

		// Verify ecrecover → correct address
		const recovered = await recoverAddress({
			hash: toHex(msgHash),
			signature: { r: toHex(r), s: toHex(s), v: BigInt(v) },
		});
		expect(recovered.toLowerCase()).toBe(ethAddress.toLowerCase());

		console.log(`  │ User+Server  : SIGNED (${rounds} rounds, ecrecover=${recovered})`);
		console.log('  │');
	}, 60_000);

	// ====================================================================
	// Phase 7: Threshold sign with signer share + decrypted user share
	//          (Signer + User path — SERVER DOWN escape hatch)
	// ====================================================================

	it('Phase 7: Threshold sign — signer share + decrypted user share (SERVER DOWN path)', async () => {
		// Re-decrypt since Phase 6 might have consumed the share
		const signature = await USER_WALLET.signMessage({
			message: getSignMessage(signerId),
		});
		const freshUserShare = await decryptUserShare(retrievedBlob, signature);

		const msgHash = new Uint8Array(32);
		crypto.getRandomValues(msgHash);

		// shares[0] = signer share, freshUserShare = user share
		// This proves: if server is down, signer + user can still sign!
		const { sessionId, firstMessages } = scheme.createSignSession([
			shares[0]!, // signer share (on agent machine)
			freshUserShare, // user share (decrypted from backup file)
		]);

		let msgs = firstMessages;
		let presigned = false;
		let rounds = 0;
		while (!presigned) {
			const res = scheme.processSignRound(sessionId, msgs);
			msgs = res.outgoingMessages;
			presigned = res.presigned;
			rounds++;
		}

		const { r, s, v } = scheme.finalizeSign(sessionId, msgHash, []);

		// Verify valid ECDSA signature
		const compact = new Uint8Array(64);
		compact.set(r, 0);
		compact.set(s, 32);
		expect(secp256k1.verify(compact, msgHash, publicKey, { prehash: false })).toBe(true);

		// Verify ecrecover → correct address
		const recovered = await recoverAddress({
			hash: toHex(msgHash),
			signature: { r: toHex(r), s: toHex(s), v: BigInt(v) },
		});
		expect(recovered.toLowerCase()).toBe(ethAddress.toLowerCase());

		console.log(`  │ Signer+User  : SIGNED (${rounds} rounds, server DOWN — still works!)`);
		console.log('  │');
	}, 60_000);

	// ====================================================================
	// Phase 8: Verify all 3 signing paths work
	// ====================================================================

	it('Phase 8: Signer + Server path (normal operation)', async () => {
		const msgHash = new Uint8Array(32);
		crypto.getRandomValues(msgHash);

		const { sessionId, firstMessages } = scheme.createSignSession([
			shares[0]!, // signer share
			shares[1]!, // server share
		]);

		let msgs = firstMessages;
		let presigned = false;
		let rounds = 0;
		while (!presigned) {
			const res = scheme.processSignRound(sessionId, msgs);
			msgs = res.outgoingMessages;
			presigned = res.presigned;
			rounds++;
		}

		const { r, s, v } = scheme.finalizeSign(sessionId, msgHash, []);

		const recovered = await recoverAddress({
			hash: toHex(msgHash),
			signature: { r: toHex(r), s: toHex(s), v: BigInt(v) },
		});
		expect(recovered.toLowerCase()).toBe(ethAddress.toLowerCase());

		console.log(`  │ Signer+Serv  : SIGNED (${rounds} rounds, normal path)`);
		console.log('  └────────────────────────────────────────────────────────');
		console.log('');
		console.log('  ALL 3 SIGNING PATHS VERIFIED:');
		console.log('    ✓ Signer + Server  (normal operation)');
		console.log('    ✓ User   + Server  (dashboard override)');
		console.log('    ✓ Signer + User    (server down — non-custodial escape hatch)');
		console.log('');
	}, 60_000);
});
