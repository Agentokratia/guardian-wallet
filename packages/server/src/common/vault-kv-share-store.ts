import type { IShareStore } from '@agentokratia/guardian-core';
import { Inject, Injectable, Logger } from '@nestjs/common';
import NodeVault from 'node-vault';
import { APP_CONFIG, type AppConfig } from './config.js';

@Injectable()
export class VaultKvShareStore implements IShareStore {
	private readonly logger = new Logger(VaultKvShareStore.name);
	private readonly vault: NodeVault.client;
	private readonly kvMount: string;
	private readonly sharePrefix: string;

	constructor(@Inject(APP_CONFIG) config: AppConfig) {
		this.vault = NodeVault({
			apiVersion: 'v1',
			endpoint: config.VAULT_ADDR,
			token: config.VAULT_TOKEN,
		});
		this.kvMount = config.VAULT_KV_MOUNT;
		this.sharePrefix = config.VAULT_SHARE_PREFIX;
	}

	async storeShare(path: string, share: Uint8Array): Promise<void> {
		const fullPath = `${this.sharePrefix}/${path}`;
		const encoded = Buffer.from(share).toString('base64');
		await this.vault.write(`${this.kvMount}/data/${fullPath}`, {
			data: { share: encoded },
		});
		this.logger.log(`Stored share at ${fullPath}`);
	}

	async getShare(path: string): Promise<Uint8Array> {
		const fullPath = `${this.sharePrefix}/${path}`;
		const result = await this.vault.read(`${this.kvMount}/data/${fullPath}`);
		const encoded = result.data.data.share as string;
		return new Uint8Array(Buffer.from(encoded, 'base64'));
	}

	async deleteShare(path: string): Promise<void> {
		const fullPath = `${this.sharePrefix}/${path}`;
		await this.vault.delete(`${this.kvMount}/metadata/${fullPath}`);
		this.logger.log(`Deleted share at ${fullPath}`);
	}

	async healthCheck(): Promise<boolean> {
		try {
			const result = await this.vault.health();
			return result.sealed === false;
		} catch {
			return false;
		}
	}
}
