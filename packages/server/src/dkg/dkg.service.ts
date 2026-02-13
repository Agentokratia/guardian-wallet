import {
	BadRequestException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
	type OnModuleInit,
} from '@nestjs/common';
import type { IVaultStore } from '@agentokratia/guardian-core';
import { CGGMP24Scheme } from '@agentokratia/guardian-schemes';
import { wipeBuffer } from '../common/crypto-utils.js';
import { VAULT_STORE } from '../common/vault.module.js';
import { SignerRepository } from '../signers/signer.repository.js';
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
 * - Share[1] (server): stored in Vault as JSON { coreShare, auxInfo }
 * - Share[2] (user): returned to client for wallet encryption
 */
@Injectable()
export class DKGService implements OnModuleInit {
	private readonly logger = new Logger(DKGService.name);
	private readonly scheme = new CGGMP24Scheme();

	// Track pending DKG sessions (validated signer IDs awaiting finalization)
	private readonly pendingSessions = new Map<
		string,
		{ signerId: string; createdAt: number }
	>();

	constructor(
		@Inject(SignerRepository) private readonly signerRepo: SignerRepository,
		@Inject(VAULT_STORE) private readonly vault: IVaultStore,
		@Inject(AuxInfoPoolService) private readonly auxInfoPool: AuxInfoPoolService,
	) {
		// Cleanup expired sessions every 30s
		setInterval(() => {
			const now = Date.now();
			for (const [id, entry] of this.pendingSessions) {
				if (now - entry.createdAt > 180_000) {
					this.pendingSessions.delete(id);
				}
			}
		}, 30_000);
	}

	/**
	 * Load caches and initialize WASM for signing on startup.
	 * Triggers background AuxInfo generation if none cached.
	 */
	async onModuleInit(): Promise<void> {
		const loaded = await this.scheme.loadCachedPrimes();
		const hasFast = await this.scheme.hasPrimesReady();
		if (hasFast) {
			this.logger.log(`Loaded ${loaded} cache items — DKG acceleration ready`);
		} else {
			this.logger.warn('No cached AuxInfo or primes — starting background generation');
			await this.scheme.ensureAuxInfoCached();
		}

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

		let poolAuxInfo: string | null = null;
		try {
			poolAuxInfo = await this.auxInfoPool.take();
		} catch (err) {
			this.logger.warn(`Pool take() failed: ${String(err)} — falling back to PrimeCache`);
		}

		if (poolAuxInfo) {
			this.logger.log(`Starting DKG for signer ${input.signerId}... (pool AuxInfo — ~1s)`);
		} else {
			const hasCachedPrimes = await this.scheme.hasPrimesReady();
			this.logger.log(
				`Starting DKG for signer ${input.signerId}... (no pool, primes: ${hasCachedPrimes ? 'yes' : 'no'})`,
			);
		}

		const startTime = Date.now();

		const dkgResult = await this.scheme.runDkg(
			3,
			2,
			poolAuxInfo ? { cachedAuxInfo: poolAuxInfo } : undefined,
		);

		const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
		this.logger.log(`DKG complete in ${elapsed}s — ${dkgResult.shares.length} shares generated`);

		if (dkgResult.shares.length < 3) {
			throw new BadRequestException(
				`Expected 3 shares, got ${dkgResult.shares.length}`,
			);
		}

		// Bundle each party's key material: { coreShare: base64, auxInfo: base64 }
		const signerKeyMaterial = bundleKeyMaterial(
			dkgResult.shares[0]!.coreShare,
			dkgResult.shares[0]!.auxInfo,
		);
		const serverKeyMaterial = bundleKeyMaterial(
			dkgResult.shares[1]!.coreShare,
			dkgResult.shares[1]!.auxInfo,
		);
		const userKeyMaterial = bundleKeyMaterial(
			dkgResult.shares[2]!.coreShare,
			dkgResult.shares[2]!.auxInfo,
		);

		try {
			// Derive Ethereum address from shared public key
			const ethAddress = this.scheme.deriveAddress(dkgResult.publicKey);

			// Store server key material in Vault
			const vaultPath = input.signerId;
			await this.vault.storeShare(vaultPath, serverKeyMaterial);

			// Update signer record
			await this.signerRepo.update(input.signerId, {
				ethAddress,
				dkgCompleted: true,
				vaultSharePath: vaultPath,
			});

			this.logger.log(`DKG finalized for signer ${input.signerId}, address: ${ethAddress}`);

			// Return signer + user key material bundles.
			// Server key material stays in Vault — never returned.
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
