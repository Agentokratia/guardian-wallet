import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type {
	EncryptedEnvelope,
	IKmsProvider,
	IShareStore,
} from '@agentokratia/guardian-core';
import type { SupabaseClient } from '@supabase/supabase-js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TABLE = 'encrypted_shares';

export class EnvelopeStoreProvider implements IShareStore {
	private readonly logger = new Logger(EnvelopeStoreProvider.name);

	constructor(
		private readonly kms: IKmsProvider,
		private readonly supabase: SupabaseClient,
	) {}

	async storeShare(path: string, share: Uint8Array): Promise<void> {
		const { plaintextKey, encryptedKey, keyId } = await this.kms.generateDataKey();

		try {
			const iv = randomBytes(IV_LENGTH);
			const cipher = createCipheriv(ALGORITHM, plaintextKey, iv);
			cipher.setAAD(Buffer.from(path, 'utf-8'));

			const encrypted = Buffer.concat([
				cipher.update(share),
				cipher.final(),
			]);
			const authTag = cipher.getAuthTag();

			const envelope: EncryptedEnvelope = {
				version: 1,
				keyId,
				encryptedDek: Buffer.from(encryptedKey).toString('base64'),
				iv: iv.toString('base64'),
				ciphertext: encrypted.toString('base64'),
				authTag: authTag.toString('base64'),
				algorithm: ALGORITHM,
				aadPath: path,
			};

			const { error } = await this.supabase
				.from(TABLE)
				.upsert(
					{ path, envelope, updated_at: new Date().toISOString() },
					{ onConflict: 'path' },
				);

			if (error) {
				throw new Error(`Failed to store encrypted share: ${error.message}`);
			}

			this.logger.log(`Stored encrypted share at ${path} [kms=${this.kms.name}]`);
		} finally {
			// Wipe DEK from memory
			plaintextKey.fill(0);
		}
	}

	async getShare(path: string): Promise<Uint8Array> {
		const { data, error } = await this.supabase
			.from(TABLE)
			.select('envelope')
			.eq('path', path)
			.single();

		if (error || !data) {
			throw new Error(`Share not found at path: ${path}`);
		}

		const envelope = data.envelope as EncryptedEnvelope;
		const encryptedKey = new Uint8Array(
			Buffer.from(envelope.encryptedDek, 'base64'),
		);

		const plaintextKey = await this.kms.decryptDataKey(
			encryptedKey,
			envelope.keyId,
		);

		try {
			const iv = Buffer.from(envelope.iv, 'base64');
			const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
			const authTag = Buffer.from(envelope.authTag, 'base64');

			const decipher = createDecipheriv(ALGORITHM, plaintextKey, iv);
			decipher.setAAD(Buffer.from(path, 'utf-8'));
			decipher.setAuthTag(authTag);

			const decrypted = Buffer.concat([
				decipher.update(ciphertext),
				decipher.final(),
			]);

			this.logger.log(`Retrieved encrypted share at ${path} [kms=${this.kms.name}]`);
			return new Uint8Array(decrypted);
		} finally {
			// Wipe DEK from memory
			plaintextKey.fill(0);
		}
	}

	async deleteShare(path: string): Promise<void> {
		const { error } = await this.supabase
			.from(TABLE)
			.delete()
			.eq('path', path);

		if (error) {
			throw new Error(`Failed to delete share at path: ${path}`);
		}

		this.logger.log(`Deleted encrypted share at ${path}`);
	}

	async healthCheck(): Promise<boolean> {
		try {
			const [kmsOk, dbOk] = await Promise.all([
				this.kms.healthCheck(),
				this.checkDb(),
			]);
			return kmsOk && dbOk;
		} catch {
			return false;
		}
	}

	private async checkDb(): Promise<boolean> {
		try {
			const { error } = await this.supabase
				.from(TABLE)
				.select('path')
				.limit(1);
			return !error;
		} catch {
			return false;
		}
	}
}
