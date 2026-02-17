export interface IKmsProvider {
	readonly name: string;

	generateDataKey(): Promise<{
		plaintextKey: Uint8Array; // 32 bytes — use then wipe
		encryptedKey: Uint8Array; // store alongside ciphertext
		keyId: string; // KMS key identifier
	}>;

	decryptDataKey(encryptedKey: Uint8Array, keyId: string): Promise<Uint8Array>;

	healthCheck(): Promise<boolean>;

	/** Wipe any in-memory key material (e.g., local-file master key) */
	destroy(): Promise<void>;
}
