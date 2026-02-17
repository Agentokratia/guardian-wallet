import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SignerStatus } from '@agentokratia/guardian-core';
import type {
	ChainName,
	IShareStore,
	SchemeName,
	Signer,
	SignerType,
} from '@agentokratia/guardian-core';
import { generateApiKey, hashApiKey } from '../common/crypto-utils.js';
import { SHARE_STORE } from '../common/share-store.module.js';
import { SignerRepository } from './signer.repository.js';
import type { CreateSignerData } from './signer.types.js';

export interface CreateSignerInput {
	name: string;
	description?: string;
	type: SignerType;
	chain?: ChainName;
	scheme?: SchemeName;
	network?: string;
	ownerAddress: string;
}

export interface CreateSignerOutput {
	signer: Signer;
	apiKey: string;
}

export interface UpdateSignerInput {
	readonly name?: string;
	readonly description?: string;
}

@Injectable()
export class SignerService {
	private readonly logger = new Logger(SignerService.name);

	constructor(
		@Inject(SignerRepository) private readonly signerRepo: SignerRepository,
		@Inject(SHARE_STORE) private readonly shareStore: IShareStore,
	) {}

	async list(): Promise<Signer[]> {
		return this.signerRepo.findAll();
	}

	async listByOwner(ownerAddress: string): Promise<Signer[]> {
		return this.signerRepo.findByOwner(ownerAddress);
	}

	async get(id: string): Promise<Signer> {
		const signer = await this.signerRepo.findById(id);
		if (!signer) {
			throw new NotFoundException(`Signer not found: ${id}`);
		}
		return signer;
	}

	async create(input: CreateSignerInput): Promise<CreateSignerOutput> {
		const apiKey = generateApiKey();
		const apiKeyHash = hashApiKey(apiKey);

		const placeholder = `0x${crypto.randomUUID().replace(/-/g, '').padEnd(40, '0')}`;
		const vaultSharePath = 'pending';

		const signer = await this.signerRepo.create({
			name: input.name,
			description: input.description,
			type: input.type,
			ethAddress: placeholder,
			chain: input.chain ?? ('ethereum' as ChainName),
			scheme: input.scheme ?? ('cggmp24' as SchemeName),
			network: input.network,
			ownerAddress: input.ownerAddress,
			apiKeyHash,
			vaultSharePath,
		} as CreateSignerData);

		return { signer, apiKey };
	}

	async update(id: string, input: UpdateSignerInput): Promise<Signer> {
		const existing = await this.signerRepo.findById(id);
		if (!existing) {
			throw new NotFoundException(`Signer not found: ${id}`);
		}

		return this.signerRepo.update(id, {
			name: input.name,
			description: input.description,
		});
	}

	async pause(id: string): Promise<Signer> {
		const signer = await this.signerRepo.findById(id);
		if (!signer) {
			throw new NotFoundException(`Signer not found: ${id}`);
		}
		if (signer.status !== SignerStatus.ACTIVE) {
			throw new BadRequestException(`Cannot pause signer with status: ${signer.status}`);
		}
		return this.signerRepo.update(id, { status: SignerStatus.PAUSED });
	}

	async resume(id: string): Promise<Signer> {
		const signer = await this.signerRepo.findById(id);
		if (!signer) {
			throw new NotFoundException(`Signer not found: ${id}`);
		}
		if (signer.status !== SignerStatus.PAUSED) {
			throw new BadRequestException(`Cannot resume signer with status: ${signer.status}`);
		}
		return this.signerRepo.update(id, { status: SignerStatus.ACTIVE });
	}

	async regenerateApiKey(id: string): Promise<{ signer: Signer; apiKey: string }> {
		const signer = await this.signerRepo.findById(id);
		if (!signer) {
			throw new NotFoundException(`Signer not found: ${id}`);
		}
		if (signer.status === SignerStatus.REVOKED) {
			throw new BadRequestException('Cannot regenerate API key for a revoked signer');
		}

		const apiKey = generateApiKey();
		const apiKeyHash = hashApiKey(apiKey);
		const updated = await this.signerRepo.update(id, { apiKeyHash } as Partial<Signer>);

		return { signer: updated, apiKey };
	}

	async revoke(id: string): Promise<Signer> {
		const signer = await this.signerRepo.findById(id);
		if (!signer) {
			throw new NotFoundException(`Signer not found: ${id}`);
		}
		if (signer.status === SignerStatus.REVOKED) {
			throw new BadRequestException('Signer is already revoked');
		}

		if (signer.vaultSharePath && signer.vaultSharePath !== 'pending') {
			try {
				await this.shareStore.deleteShare(signer.vaultSharePath);
			} catch (error) {
				this.logger.error(
					`SECURITY: Failed to delete server share for signer ${id} at path ${signer.vaultSharePath}. Manual cleanup required. Error: ${error}`,
				);
			}
		}

		return this.signerRepo.update(id, { status: SignerStatus.REVOKED });
	}
}
