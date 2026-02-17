export interface EncryptedEnvelope {
	readonly version: 1;
	readonly keyId: string;
	readonly encryptedDek: string; // base64
	readonly iv: string; // base64, 12 bytes
	readonly ciphertext: string; // base64
	readonly authTag: string; // base64, 16 bytes (separate from ciphertext for clarity)
	readonly algorithm: 'aes-256-gcm';
	readonly aadPath: string; // path used as AAD — stored for auditability
}
