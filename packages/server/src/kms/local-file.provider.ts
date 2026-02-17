import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IKmsProvider } from '@agentokratia/guardian-core';
import { Logger } from '@nestjs/common';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_ID = 'local-file-master';

export interface LocalFileKmsOptions {
	keyFilePath: string;
}

export class LocalFileKmsProvider implements IKmsProvider {
	readonly name = 'local-file';
	private readonly logger = new Logger(LocalFileKmsProvider.name);
	private masterKey: Buffer;

	constructor(options: LocalFileKmsOptions) {
		const hex = readFileSync(options.keyFilePath, 'utf-8').trim();
		const buf = Buffer.from(hex, 'hex');
		if (buf.length !== KEY_LENGTH) {
			throw new Error(
				`Master key must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex chars), got ${buf.length} bytes`,
			);
		}
		this.masterKey = buf;

		if (process.env.NODE_ENV === 'production') {
			this.logger.warn(
				'LocalFileKmsProvider is intended for dev/simple deployments. ' +
					'Consider a cloud KMS (AWS, GCP, Azure) for production.',
			);
		}

		this.logger.log('Master key loaded from file');
	}

	async generateDataKey(): Promise<{
		plaintextKey: Uint8Array;
		encryptedKey: Uint8Array;
		keyId: string;
	}> {
		const plaintextKey = randomBytes(KEY_LENGTH);
		const iv = randomBytes(IV_LENGTH);

		const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);
		const encrypted = Buffer.concat([cipher.update(plaintextKey), cipher.final()]);
		const authTag = cipher.getAuthTag();

		// Pack: iv (12) + authTag (16) + encrypted DEK (32)
		const encryptedKey = Buffer.concat([iv, authTag, encrypted]);

		return {
			plaintextKey,
			encryptedKey: new Uint8Array(encryptedKey),
			keyId: KEY_ID,
		};
	}

	async decryptDataKey(encryptedKey: Uint8Array, _keyId: string): Promise<Uint8Array> {
		const buf = Buffer.from(encryptedKey);
		if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + KEY_LENGTH) {
			throw new Error('Invalid encrypted key format');
		}

		const iv = buf.subarray(0, IV_LENGTH);
		const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
		const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

		const decipher = createDecipheriv(ALGORITHM, this.masterKey, iv);
		decipher.setAuthTag(authTag);

		const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
		return new Uint8Array(decrypted);
	}

	async healthCheck(): Promise<boolean> {
		// Key must exist and not be wiped (all zeros)
		return this.masterKey.length === KEY_LENGTH && !this.masterKey.every((b) => b === 0);
	}

	async destroy(): Promise<void> {
		this.masterKey.fill(0);
		this.logger.log('Master key wiped from memory');
	}
}
