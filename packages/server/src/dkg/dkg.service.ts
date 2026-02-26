import {
	ChainName,
	type IShareStore,
	type SchemeName,
	type SignerType,
} from '@agentokratia/guardian-core';
import { CGGMP24Scheme } from '@agentokratia/guardian-schemes';
import {
	BadRequestException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
	type OnModuleDestroy,
	type OnModuleInit,
	ServiceUnavailableException,
} from '@nestjs/common';
import { hashApiKey, wipeBuffer } from '../common/crypto-utils.js';
import { SHARE_STORE } from '../common/share-store.module.js';
import { SignerRepository } from '../signers/signer.repository.js';
import { SignerService } from '../signers/signer.service.js';
import { AuxInfoPoolService } from './aux-info-pool.service.js';

export interface InitDKGInput {
	signerId: string;
}

export interface InitDKGOutput {
	sessionId: string;
	signerId: string;
}

export interface FinalizeDKGInput {
	sessionId: string;
	signerId: string;
}

export interface FinalizeDKGOutput {
	signerId: string;
	ethAddress: string;
	/** Base64-encoded JSON: { coreShare, auxInfo } */
	signerShare: string;
	/** Base64-encoded JSON: { coreShare, auxInfo } */
	userShare: string;
}

/**
 * CGGMP24 DKG service.
 *
 * Runs a complete two-phase DKG ceremony via WASM in a single call:
 * - Phase A: aux_info_gen (Paillier primes — expensive)
 * - Phase B: keygen (threshold ECDSA key shares — lightweight)
 *
 * All 3 parties run locally inside the WASM module.
 *
 * Distribution:
 * - Share[0] (signer): returned to client for encrypted .share.enc file
 * - Share[1] (server): stored in share store as JSON { coreShare, auxInfo }
 * - Share[2] (user): returned to client for wallet encryption
 */
@Injectable()
export class DKGService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(DKGService.name);
	private readonly scheme = new CGGMP24Scheme();

	// Track pending DKG sessions (validated signer IDs awaiting finalization)
	private readonly pendingSessions = new Map<string, { signerId: string; createdAt: number }>();
	private cleanupTimer: ReturnType<typeof setInterval>;

	constructor(
		@Inject(SignerRepository) private readonly signerRepo: SignerRepository,
		@Inject(SignerService) private readonly signerService: SignerService,
		@Inject(SHARE_STORE) private readonly shareStore: IShareStore,
		@Inject(AuxInfoPoolService) private readonly auxInfoPool: AuxInfoPoolService,
	) {
		// Cleanup expired sessions every 30s
		this.cleanupTimer = setInterval(() => {
			const now = Date.now();
			for (const [id, entry] of this.pendingSessions) {
				if (now - entry.createdAt > 180_000) {
					this.pendingSessions.delete(id);
				}
			}
		}, 30_000);
	}

	onModuleDestroy(): void {
		clearInterval(this.cleanupTimer);
		this.pendingSessions.clear();
	}

	/**
	 * Initialize WASM for signing on startup.
	 * DKG acceleration is handled by the AuxInfo pool.
	 */
	async onModuleInit(): Promise<void> {
		// Init WASM for signing (DKG uses native binary, signing still needs WASM)
		try {
			await this.scheme.initWasm();
			this.logger.log('WASM module initialized for signing');
		} catch (err) {
			this.logger.warn(`WASM init failed: ${String(err)} — signing will not work`);
		}

		const poolStatus = this.auxInfoPool.getStatus();
		this.logger.log(`AuxInfo pool: ${poolStatus.size}/${poolStatus.target} entries`);
	}

	/**
	 * Initialize DKG: validate the signer and return a session ID.
	 *
	 * The actual DKG computation happens in finalize().
	 */
	async init(input: InitDKGInput): Promise<InitDKGOutput> {
		const signer = await this.signerRepo.findById(input.signerId);
		if (!signer) {
			throw new NotFoundException(`Signer not found: ${input.signerId}`);
		}
		if (signer.dkgCompleted) {
			throw new BadRequestException(`DKG already completed for signer: ${input.signerId}`);
		}

		const sessionId = crypto.randomUUID();
		this.pendingSessions.set(sessionId, {
			signerId: input.signerId,
			createdAt: Date.now(),
		});

		return {
			sessionId,
			signerId: input.signerId,
		};
	}

	/**
	 * Finalize DKG: run the complete CGGMP24 ceremony and distribute shares.
	 *
	 * This is a blocking operation (~30-120s) that runs the full two-phase DKG
	 * inside the WASM module. All 3 parties execute locally with automatic
	 * message routing.
	 */
	async finalize(input: FinalizeDKGInput): Promise<FinalizeDKGOutput> {
		const signer = await this.signerRepo.findById(input.signerId);
		if (!signer) {
			throw new NotFoundException(`Signer not found: ${input.signerId}`);
		}

		const pending = this.pendingSessions.get(input.sessionId);
		if (!pending) {
			throw new BadRequestException(`No pending DKG session: ${input.sessionId}`);
		}
		if (pending.signerId !== input.signerId) {
			throw new BadRequestException('Session/signer mismatch');
		}
		this.pendingSessions.delete(input.sessionId);

		const poolAuxInfo = await this.auxInfoPool.take();
		if (!poolAuxInfo) {
			throw new ServiceUnavailableException('AuxInfo pool is empty — try again in a few minutes.');
		}

		this.logger.log(`Starting DKG for signer ${input.signerId}... (pool AuxInfo — ~1s)`);

		const startTime = Date.now();

		const dkgResult = await this.scheme.runDkg(3, 2, { cachedAuxInfo: poolAuxInfo });

		const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
		this.logger.log(`DKG complete in ${elapsed}s — ${dkgResult.shares.length} shares generated`);

		if (dkgResult.shares.length < 3) {
			throw new BadRequestException(`Expected 3 shares, got ${dkgResult.shares.length}`);
		}

		// Bundle each party's key material: { coreShare: base64, auxInfo: base64 }
		const [share0, share1, share2] = dkgResult.shares;
		if (!share0 || !share1 || !share2) {
			throw new BadRequestException(`Expected 3 shares, got ${dkgResult.shares.length}`);
		}
		const signerKeyMaterial = bundleKeyMaterial(share0.coreShare, share0.auxInfo);
		const serverKeyMaterial = bundleKeyMaterial(share1.coreShare, share1.auxInfo);
		const userKeyMaterial = bundleKeyMaterial(share2.coreShare, share2.auxInfo);

		try {
			// Derive Ethereum address from shared public key
			const ethAddress = this.scheme.deriveAddress(dkgResult.publicKey);

			// Store server key material in share store
			const vaultPath = input.signerId;
			await this.shareStore.storeShare(vaultPath, serverKeyMaterial);

			// Update signer record
			await this.signerRepo.update(input.signerId, {
				ethAddress,
				dkgCompleted: true,
				vaultSharePath: vaultPath,
			});

			this.logger.log(`DKG finalized for signer ${input.signerId}, address: ${ethAddress}`);

			// Return signer + user key material bundles.
			// Server key material stays in share store — never returned.
			return {
				signerId: input.signerId,
				ethAddress,
				signerShare: Buffer.from(signerKeyMaterial).toString('base64'),
				userShare: Buffer.from(userKeyMaterial).toString('base64'),
			};
		} finally {
			// CRITICAL: Wipe all key material buffers
			wipeBuffer(serverKeyMaterial);
			wipeBuffer(signerKeyMaterial);
			wipeBuffer(userKeyMaterial);
			for (const share of dkgResult.shares) {
				wipeBuffer(share.coreShare);
				wipeBuffer(share.auxInfo);
			}
			wipeBuffer(dkgResult.publicKey);
			this.logger.debug('All key material buffers wiped');
		}
	}

	/**
	 * Atomic create + DKG for authenticated signer creation.
	 *
	 * 1. Claims auxInfo from pool FIRST (no DB record if pool empty)
	 * 2. Creates signer record with ownerId from session
	 * 3. Runs DKG with the pre-claimed auxInfo
	 * 4. On failure, hard-deletes the signer (no ghost records)
	 */
	async createWithDKG(input: {
		name: string;
		type: SignerType;
		scheme: SchemeName;
		network: string;
		ownerId: string;
	}): Promise<{
		signerId: string;
		ethAddress: string;
		apiKey: string;
		signerShare: string;
		userShare: string;
	}> {
		// 1. Claim auxInfo BEFORE creating signer — no ghost records if pool empty
		const poolAuxInfo = await this.auxInfoPool.take();
		if (!poolAuxInfo) {
			throw new ServiceUnavailableException(
				'AuxInfo pool is empty — the system is warming up. Try again in a minute.',
			);
		}

		// 2. Create signer record (pool entry already claimed)
		const { signer, apiKey } = await this.signerService.create({
			name: input.name,
			type: input.type,
			chain: ChainName.ETHEREUM,
			scheme: input.scheme,
			network: input.network,
			ownerId: input.ownerId,
		});

		try {
			// 3. Run DKG with pre-claimed auxInfo
			this.logger.log(`Starting DKG for signer ${signer.id}... (pool AuxInfo — ~1s)`);
			const startTime = Date.now();

			const dkgResult = await this.scheme.runDkg(3, 2, { cachedAuxInfo: poolAuxInfo });

			const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
			this.logger.log(`DKG complete in ${elapsed}s — ${dkgResult.shares.length} shares generated`);

			if (dkgResult.shares.length < 3) {
				throw new BadRequestException(`Expected 3 shares, got ${dkgResult.shares.length}`);
			}

			const [share0, share1, share2] = dkgResult.shares;
			if (!share0 || !share1 || !share2) {
				throw new BadRequestException(`Expected 3 shares, got ${dkgResult.shares.length}`);
			}

			const signerKeyMaterial = bundleKeyMaterial(share0.coreShare, share0.auxInfo);
			const serverKeyMaterial = bundleKeyMaterial(share1.coreShare, share1.auxInfo);
			const userKeyMaterial = bundleKeyMaterial(share2.coreShare, share2.auxInfo);

			try {
				const ethAddress = this.scheme.deriveAddress(dkgResult.publicKey);

				// Store server share + update signer record
				await this.shareStore.storeShare(signer.id, serverKeyMaterial);
				await this.signerRepo.update(signer.id, {
					ethAddress,
					dkgCompleted: true,
					vaultSharePath: signer.id,
				});

				this.logger.log(`DKG finalized for signer ${signer.id}, address: ${ethAddress}`);

				return {
					signerId: signer.id,
					ethAddress,
					apiKey,
					signerShare: Buffer.from(signerKeyMaterial).toString('base64'),
					userShare: Buffer.from(userKeyMaterial).toString('base64'),
				};
			} finally {
				// CRITICAL: Wipe all key material buffers
				wipeBuffer(serverKeyMaterial);
				wipeBuffer(signerKeyMaterial);
				wipeBuffer(userKeyMaterial);
				for (const share of dkgResult.shares) {
					wipeBuffer(share.coreShare);
					wipeBuffer(share.auxInfo);
				}
				wipeBuffer(dkgResult.publicKey);
			}
		} catch (error) {
			// Hard delete — no ghost records
			this.logger.error(`createWithDKG failed for "${input.name}", deleting signer ${signer.id}`);
			try {
				await this.signerRepo.delete(signer.id);
			} catch {
				this.logger.error(`Failed to delete signer ${signer.id} after DKG failure`);
			}
			throw error;
		}
	}
}

/**
 * Bundle a CoreKeyShare + AuxInfo into a single JSON blob.
 * Format: { "coreShare": "<base64>", "auxInfo": "<base64>" }
 */
function bundleKeyMaterial(coreShare: Uint8Array, auxInfo: Uint8Array): Uint8Array {
	const json = JSON.stringify({
		coreShare: Buffer.from(coreShare).toString('base64'),
		auxInfo: Buffer.from(auxInfo).toString('base64'),
	});
	return new Uint8Array(Buffer.from(json, 'utf-8'));
}
