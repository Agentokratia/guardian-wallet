import {
	ConflictException,
	ForbiddenException,
	GoneException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service.js';
import { SignerRepository } from '../signers/signer.repository.js';

const TRANSFER_EXPIRY_MINUTES = 10;
const LOCK_EXPIRY_MINUTES = 5;

interface TransferRow {
	id: string;
	signer_id: string;
	initiator_id: string;
	encrypted_payload: string | null;
	direction: string;
	expires_at: string;
	locked_at: string | null;
	locked_by: string | null;
	claimed_at: string | null;
	claimed_by: string | null;
	created_at: string;
}

@Injectable()
export class TransferService {
	private readonly logger = new Logger(TransferService.name);

	constructor(
		@Inject(SupabaseService) private readonly supabase: SupabaseService,
		@Inject(SignerRepository) private readonly signerRepo: SignerRepository,
	) {}

	/**
	 * Initiate a share transfer. Creates a transfer record with a 10-minute expiry.
	 */
	async initiate(
		signerId: string,
		initiatorId: string,
		direction: 'cli_to_dashboard' | 'dashboard_to_cli',
	): Promise<{ transferId: string; expiresAt: string }> {
		// Verify signer exists and initiator owns it
		const signer = await this.signerRepo.findById(signerId);
		if (!signer) {
			throw new NotFoundException('Signer not found');
		}
		if (signer.ownerId !== initiatorId) {
			throw new ForbiddenException('You do not own this signer');
		}

		const expiresAt = new Date(Date.now() + TRANSFER_EXPIRY_MINUTES * 60_000).toISOString();

		const { data, error } = await this.supabase.client
			.from('share_transfers')
			.insert({
				signer_id: signerId,
				initiator_id: initiatorId,
				direction,
				expires_at: expiresAt,
			})
			.select('id')
			.single();

		if (error || !data) {
			throw new Error(`Failed to create transfer: ${error?.message ?? 'unknown'}`);
		}

		return { transferId: data.id as string, expiresAt };
	}

	/**
	 * Upload the encrypted share payload for a transfer.
	 */
	async uploadPayload(transferId: string, userId: string, encryptedPayload: string): Promise<void> {
		const { data, error } = await this.supabase.client
			.from('share_transfers')
			.update({ encrypted_payload: encryptedPayload })
			.eq('id', transferId)
			.eq('initiator_id', userId)
			.is('claimed_at', null)
			.gt('expires_at', new Date().toISOString())
			.select('id')
			.single();

		if (error || !data) {
			throw new NotFoundException('Transfer not found or not authorized');
		}
	}

	/**
	 * Find pending (unclaimed, unexpired) transfer for a signer.
	 */
	async findPending(
		signerId: string,
		userId: string,
	): Promise<{ transferId: string; direction: string; expiresAt: string } | null> {
		// Verify user owns the signer
		const signer = await this.signerRepo.findById(signerId);
		if (!signer) {
			this.logger.warn(`findPending: signer not found for id=${signerId}`);
			throw new NotFoundException('Signer not found');
		}
		if (signer.ownerId !== userId) {
			this.logger.warn(
				`findPending: owner mismatch — signer.ownerId=${signer.ownerId}, userId=${userId}`,
			);
			throw new ForbiddenException('You do not own this signer');
		}

		const { data, error } = await this.supabase.client
			.from('share_transfers')
			.select('id, direction, expires_at, encrypted_payload')
			.eq('signer_id', signerId)
			.is('claimed_at', null)
			.gt('expires_at', new Date().toISOString())
			.order('created_at', { ascending: false })
			.limit(1)
			.single();

		if (error || !data) {
			this.logger.log(
				`findPending: no pending transfer for signer=${signerId} (error=${error?.message})`,
			);
			return null;
		}

		if (!data.encrypted_payload) {
			this.logger.warn(`findPending: transfer ${data.id} exists but payload not yet uploaded`);
		}

		return {
			transferId: data.id as string,
			direction: data.direction as string,
			expiresAt: data.expires_at as string,
		};
	}

	/**
	 * Claim a transfer — atomic lock + return encrypted payload.
	 * Uses two-phase claim: lock for 5 minutes, then confirm.
	 */
	async claim(
		transferId: string,
		userId: string,
	): Promise<{ encryptedPayload: string; lockExpiresAt: string }> {
		// Verify ownership: only the signer's owner can claim their transfer
		await this.verifyTransferOwnership(transferId, userId);

		const lockExpiresAt = new Date(Date.now() + LOCK_EXPIRY_MINUTES * 60_000).toISOString();
		const now = new Date().toISOString();

		// Atomic claim: only succeeds if not already claimed and not locked (or lock expired)
		const { data, error } = await this.supabase.client
			.from('share_transfers')
			.update({
				locked_at: now,
				locked_by: userId,
			})
			.eq('id', transferId)
			.is('claimed_at', null)
			.gt('expires_at', now)
			.or(
				`locked_at.is.null,locked_at.lt.${new Date(Date.now() - LOCK_EXPIRY_MINUTES * 60_000).toISOString()}`,
			)
			.select('encrypted_payload')
			.single();

		if (error || !data) {
			// Check if it's expired, already claimed, or locked
			const { data: transfer } = await this.supabase.client
				.from('share_transfers')
				.select('claimed_at, expires_at, locked_at, locked_by')
				.eq('id', transferId)
				.single();

			if (!transfer) {
				throw new NotFoundException('Transfer not found');
			}
			if (transfer.claimed_at) {
				throw new ConflictException('Transfer already claimed');
			}
			if (new Date(transfer.expires_at as string) < new Date()) {
				throw new GoneException('Transfer expired');
			}
			if (transfer.locked_at && transfer.locked_by !== userId) {
				throw new ConflictException('Transfer is locked by another user');
			}
			throw new ConflictException('Transfer could not be claimed');
		}

		const payload = data.encrypted_payload as string;
		if (!payload) {
			throw new NotFoundException('Transfer payload not yet uploaded');
		}

		return { encryptedPayload: payload, lockExpiresAt };
	}

	/**
	 * Confirm a successful claim — marks as fully claimed.
	 */
	async confirm(transferId: string, userId: string): Promise<void> {
		// Verify ownership: only the signer's owner can confirm their transfer
		await this.verifyTransferOwnership(transferId, userId);

		const now = new Date().toISOString();

		const { data, error } = await this.supabase.client
			.from('share_transfers')
			.update({
				claimed_at: now,
				claimed_by: userId,
			})
			.eq('id', transferId)
			.eq('locked_by', userId)
			.is('claimed_at', null)
			.select('id')
			.single();

		if (error || !data) {
			throw new NotFoundException('Transfer not found or not locked by you');
		}
	}

	/**
	 * Verify that the user owns the signer associated with a transfer.
	 * Rejects with 404/403 if transfer doesn't exist or user isn't the owner.
	 */
	private async verifyTransferOwnership(transferId: string, userId: string): Promise<void> {
		const { data: transfer } = await this.supabase.client
			.from('share_transfers')
			.select('signer_id')
			.eq('id', transferId)
			.single();

		if (!transfer) {
			throw new NotFoundException('Transfer not found');
		}

		const signer = await this.signerRepo.findById(transfer.signer_id as string);
		if (!signer || signer.ownerId !== userId) {
			throw new ForbiddenException('You do not own this signer');
		}
	}
}
