import { randomBytes } from 'node:crypto';
import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { verifyMessage } from 'viem';
import { ChallengeStore } from './challenge-store.js';
import { SessionService } from './session.service.js';

export interface VerifyWalletOutput {
	verified: boolean;
	token: string;
	address: string;
}

@Injectable()
export class AuthService {
	constructor(
		@Inject(ChallengeStore) private readonly challengeStore: ChallengeStore,
		@Inject(SessionService) private readonly sessionService: SessionService,
	) {}

	generateNonce(): string {
		const nonce = randomBytes(32).toString('hex');
		this.challengeStore.set(nonce, nonce);
		return nonce;
	}

	async verifyWalletSignature(
		message: string,
		signature: string,
	): Promise<VerifyWalletOutput> {
		// Extract nonce from SIWE message format:
		// "Sign in to Guardian\nNonce: {nonce}\nIssued At: {iso8601}"
		const nonce = this.extractNonce(message);
		if (!nonce) {
			throw new BadRequestException('Invalid message format: missing nonce');
		}

		// Extract address from SIWE message
		const address = this.extractAddress(message);
		if (!address) {
			throw new BadRequestException('Invalid message format: missing address');
		}

		// Verify nonce exists in challenge store (prevents replay attacks)
		const storedNonce = this.challengeStore.get(nonce);
		if (!storedNonce) {
			throw new BadRequestException('Nonce expired or not found');
		}

		// Delete nonce immediately (single use)
		this.challengeStore.delete(nonce);

		// Verify the wallet signature using viem
		const valid = await verifyMessage({
			address: address as `0x${string}`,
			message,
			signature: signature as `0x${string}`,
		});

		if (!valid) {
			throw new UnauthorizedException('Invalid wallet signature');
		}

		// Create JWT with wallet address as subject (always lowercase for consistent DB lookups)
		const normalizedAddress = address.toLowerCase();
		const token = this.sessionService.createToken(normalizedAddress);

		return { verified: true, token, address: normalizedAddress };
	}

	private extractNonce(message: string): string | null {
		const parts = message.split('Nonce: ');
		if (parts.length < 2) return null;
		const afterNonce = parts[1] as string;
		const nonce = afterNonce.split('\n')[0]?.trim();
		return nonce || null;
	}

	private extractAddress(message: string): string | null {
		const parts = message.split('Address: ');
		if (parts.length < 2) return null;
		const afterAddress = parts[1] as string;
		const address = afterAddress.split('\n')[0]?.trim();
		return address && address.startsWith('0x') ? address : null;
	}
}
