import {
	BadRequestException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
	OnModuleDestroy,
} from '@nestjs/common';
import type { DKGRoundResult, IThresholdScheme, IVaultStore } from '@agentokratia/guardian-core';
import { DKLs23Scheme } from '@agentokratia/guardian-schemes';
import { wipeBuffer } from '../common/crypto-utils.js';
import { VAULT_STORE } from '../common/vault.module.js';
import { SignerRepository } from '../signers/signer.repository.js';

const DKG_SESSION_TTL_MS = 120_000; // 2 minutes
const DKG_CLEANUP_INTERVAL_MS = 30_000;

export interface InitDKGInput {
	signerId: string;
}

export interface InitDKGOutput {
	sessionId: string;
	signerId: string;
	round: number;
}

export interface FinalizeDKGInput {
	sessionId: string;
	signerId: string;
}

export interface FinalizeDKGOutput {
	signerId: string;
	ethAddress: string;
	signerShare: string;
	userShare: string;
}

@Injectable()
export class DKGService implements OnModuleDestroy {
	private readonly logger = new Logger(DKGService.name);
	private readonly scheme: IThresholdScheme;
	/** Stores round 1 outgoing messages so finalize() can feed them to round 2. */
	private readonly pendingOutgoing = new Map<string, { messages: Uint8Array[]; createdAt: number }>();
	private readonly cleanupTimer: ReturnType<typeof setInterval>;

	constructor(
		@Inject(SignerRepository) private readonly signerRepo: SignerRepository,
		@Inject(VAULT_STORE) private readonly vault: IVaultStore,
	) {
		this.scheme = new DKLs23Scheme();
		this.cleanupTimer = setInterval(() => this.cleanupExpiredSessions(), DKG_CLEANUP_INTERVAL_MS);
	}

	onModuleDestroy(): void {
		clearInterval(this.cleanupTimer);
		this.pendingOutgoing.clear();
	}

	private cleanupExpiredSessions(): void {
		const now = Date.now();
		for (const [id, entry] of this.pendingOutgoing) {
			if (now - entry.createdAt > DKG_SESSION_TTL_MS) {
				this.pendingOutgoing.delete(id);
				this.logger.debug(`Expired DKG session ${id} cleaned up`);
			}
		}
	}

	async init(input: InitDKGInput): Promise<InitDKGOutput> {
		const signer = await this.signerRepo.findById(input.signerId);
		if (!signer) {
			throw new NotFoundException(`Signer not found: ${input.signerId}`);
		}
		if (signer.dkgCompleted) {
			throw new BadRequestException(`DKG already completed for signer: ${input.signerId}`);
		}

		const sessionId = crypto.randomUUID();

		const result: DKGRoundResult = await this.scheme.dkg(sessionId, 1, []);

		// Store round 1 outgoing — finalize() will feed them to round 2.
		// All 3 DKG parties are server-side, so no client round-trips needed.
		this.pendingOutgoing.set(sessionId, { messages: result.outgoing, createdAt: Date.now() });

		return {
			sessionId,
			signerId: input.signerId,
			round: 1,
		};
	}

	async finalize(input: FinalizeDKGInput): Promise<FinalizeDKGOutput> {
		const signer = await this.signerRepo.findById(input.signerId);
		if (!signer) {
			throw new NotFoundException(`Signer not found: ${input.signerId}`);
		}

		// Get the round 1 outgoing messages stored by init()
		const pending = this.pendingOutgoing.get(input.sessionId);
		if (!pending) {
			throw new BadRequestException(`No pending DKG session: ${input.sessionId}`);
		}
		this.pendingOutgoing.delete(input.sessionId);
		let incoming = pending.messages;

		// Run rounds 2-5 internally. All 3 parties are server-side,
		// so each round's outgoing feeds directly into the next round's incoming.
		let result: DKGRoundResult = { outgoing: [], finished: false };
		for (let round = 2; round <= 5; round++) {
			result = await this.scheme.dkg(input.sessionId, round, incoming);
			incoming = result.outgoing;
		}

		if (!result.finished || !result.shares || !result.publicKey) {
			throw new BadRequestException('DKG did not complete — missing shares or public key');
		}

		const shares = result.shares;

		if (shares.length < 3) {
			throw new BadRequestException(`Expected 3 shares, got ${shares.length}`);
		}

		const signerShare = shares[0] as Uint8Array; // Index 0 -> signer share (participant 1)
		const serverShare = shares[1] as Uint8Array; // Index 1 -> server share (participant 2)
		const userShare = shares[2] as Uint8Array; // Index 2 -> user share (participant 3)

		try {
			// Derive Ethereum address from public key
			const ethAddress = this.scheme.deriveAddress(result.publicKey);

			// Store server share in Vault
			const vaultPath = input.signerId;
			await this.vault.storeShare(vaultPath, serverShare);

			// User share goes to the CLIENT — never stored server-side.
			// Only the server share lives in Vault.

			// Update signer record
			await this.signerRepo.update(input.signerId, {
				ethAddress,
				dkgCompleted: true,
				vaultSharePath: vaultPath,
			});

			this.logger.log(`DKG finalized for signer ${input.signerId}, address: ${ethAddress}`);

			// Return both signer + user shares to the client.
			// Server share stays in Vault — never returned.
			return {
				signerId: input.signerId,
				ethAddress,
				signerShare: Buffer.from(signerShare).toString('base64'),
				userShare: Buffer.from(userShare).toString('base64'),
			};
		} finally {
			// CRITICAL: Wipe all share buffers
			wipeBuffer(serverShare);
			wipeBuffer(signerShare);
			wipeBuffer(userShare);
			if (result.publicKey) {
				wipeBuffer(result.publicKey);
			}
			this.logger.debug('All share buffers wiped');
		}
	}
}
