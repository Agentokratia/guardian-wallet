import { createHash, timingSafeEqual } from 'node:crypto';
import {
	generateAuthChallenge,
	generateOTP,
	generateRegistrationChallenge,
	verifyAuthentication,
	verifyRegistration,
} from '@agentokratia/guardian-auth/server';
import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/types';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { SupabaseService } from '../common/supabase.service.js';
import { ChallengeStore } from './challenge-store.js';
import type { CreateTokenInput } from './session.service.js';
import { SessionService } from './session.service.js';

export interface AuthResult {
	token: string;
	userId: string;
	email: string;
	address?: string;
}

@Injectable()
export class AuthService {
	private readonly logger = new Logger(AuthService.name);

	constructor(
		@Inject(ChallengeStore) private readonly challengeStore: ChallengeStore,
		@Inject(SessionService) private readonly sessionService: SessionService,
		@Inject(SupabaseService) private readonly supabase: SupabaseService,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
	) {}

	/**
	 * Step 1: Register email — create user if new, send OTP.
	 */
	async registerEmail(email: string): Promise<{ userId: string; isNewUser: boolean }> {
		const normalized = email.toLowerCase().trim();
		if (!normalized || !normalized.includes('@')) {
			throw new BadRequestException('Invalid email address');
		}

		// Find or create user
		let userId: string;
		let isNewUser = false;

		const { data: existing } = await this.supabase.client
			.from('users')
			.select('id, status')
			.eq('email', normalized)
			.single();

		if (existing) {
			userId = existing.id as string;
		} else {
			const { data: created, error } = await this.supabase.client
				.from('users')
				.insert({ email: normalized })
				.select('id')
				.single();

			if (error) {
				if (error.code === '23505') {
					// Race condition: user was created between select and insert
					const { data: raceUser } = await this.supabase.client
						.from('users')
						.select('id')
						.eq('email', normalized)
						.single();
					userId = (raceUser as { id: string }).id;
				} else {
					throw error;
				}
			} else {
				userId = (created as { id: string }).id;
				isNewUser = true;
			}
		}

		// Generate OTP
		const otp = generateOTP();
		const otpHash = createHash('sha256').update(otp.code).digest('hex');

		// Store OTP hash in DB
		const { error: otpInsertError } = await this.supabase.client
			.from('email_verifications')
			.insert({
				user_id: userId,
				email: normalized,
				otp_hash: otpHash,
				expires_at: otp.expiresAt.toISOString(),
			});

		if (otpInsertError) {
			this.logger.error(`Failed to insert OTP: ${JSON.stringify(otpInsertError)}`);
			throw new BadRequestException(`Failed to store verification code: ${otpInsertError.message}`);
		}

		// Send OTP
		if (this.config.EMAIL_PROVIDER === 'console') {
			this.logger.log(`[DEV] OTP for ${normalized}: ${otp.code}`);
		} else {
			// TODO: Implement Resend email sending
			this.logger.log(`[DEV] OTP for ${normalized}: ${otp.code}`);
		}

		return { userId, isNewUser };
	}

	/**
	 * Step 2: Verify email OTP — return passkey registration options.
	 */
	async verifyEmailOTP(
		email: string,
		code: string,
	): Promise<{
		userId: string;
		registrationOptions: unknown;
	}> {
		if (!/^\d{6}$/.test(code)) {
			throw new BadRequestException('Invalid code format — expected 6 digits');
		}

		const normalized = email.toLowerCase().trim();

		// Look up user
		const { data: user } = await this.supabase.client
			.from('users')
			.select('id')
			.eq('email', normalized)
			.single();

		if (!user) {
			throw new NotFoundException('User not found');
		}

		const userId = user.id as string;

		// Find latest unused OTP for this user
		const { data: otpRecord } = await this.supabase.client
			.from('email_verifications')
			.select('id, otp_hash, expires_at, is_used')
			.eq('user_id', userId)
			.eq('is_used', false)
			.order('created_at', { ascending: false })
			.limit(1)
			.single();

		if (!otpRecord) {
			throw new BadRequestException('No pending verification found');
		}

		// Check expiry
		if (new Date(otpRecord.expires_at as string) < new Date()) {
			throw new BadRequestException('Verification code expired');
		}

		// Timing-safe hash comparison
		const providedHash = createHash('sha256').update(code).digest('hex');
		const expected = Buffer.from(otpRecord.otp_hash as string, 'utf-8');
		const actual = Buffer.from(providedHash, 'utf-8');
		if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
			throw new BadRequestException('Invalid verification code');
		}

		// Mark OTP as used
		await this.supabase.client
			.from('email_verifications')
			.update({ is_used: true })
			.eq('id', otpRecord.id);

		// Mark email as verified
		await this.supabase.client
			.from('users')
			.update({
				email_verified: true,
				status: 'pending_passkey',
				updated_at: new Date().toISOString(),
			})
			.eq('id', userId);

		// Get existing credentials to exclude
		const { data: existingCreds } = await this.supabase.client
			.from('passkey_credentials')
			.select('credential_id')
			.eq('user_id', userId);

		const excludeIds = existingCreds?.map((c) => c.credential_id as string) ?? [];

		// Generate WebAuthn registration options
		const registrationOptions = await generateRegistrationChallenge({
			rpId: this.config.RP_ID,
			rpName: this.config.RP_NAME,
			userId,
			userName: normalized,
			userDisplayName: normalized.split('@')[0] ?? normalized,
			excludeCredentialIds: excludeIds,
		});

		// Store challenge for verification
		this.challengeStore.set(`reg:${userId}`, registrationOptions.challenge);

		return { userId, registrationOptions };
	}

	/**
	 * Step 3: Complete passkey registration — store credential, create session.
	 */
	async completePasskeyRegistration(
		userId: string,
		response: RegistrationResponseJSON,
		prfDerivedAddress?: string,
	): Promise<AuthResult> {
		// Consume stored challenge (atomic get + delete)
		const expectedChallenge = this.challengeStore.consume(`reg:${userId}`);
		if (!expectedChallenge) {
			throw new BadRequestException('Registration challenge expired or not found');
		}

		// Verify registration
		const verified = await verifyRegistration(
			response,
			expectedChallenge,
			this.config.RP_ID,
			this.config.ALLOWED_ORIGINS[0] ?? 'http://localhost:3000',
		);

		// Store credential in DB
		const publicKeyCoseBase64 = Buffer.from(verified.publicKey).toString('base64');

		await this.supabase.client.from('passkey_credentials').insert({
			user_id: userId,
			credential_id: verified.credentialId,
			public_key_cose: publicKeyCoseBase64,
			counter: verified.counter,
			device_type: 'platform',
		});

		// Update user with ETH address and status
		const updateData: Record<string, unknown> = {
			status: 'active',
			updated_at: new Date().toISOString(),
		};
		if (prfDerivedAddress) {
			updateData.eth_address = prfDerivedAddress.toLowerCase();
		}

		await this.supabase.client.from('users').update(updateData).eq('id', userId);

		// Get user for JWT
		const { data: updatedUser } = await this.supabase.client
			.from('users')
			.select('id, email, eth_address')
			.eq('id', userId)
			.single();

		if (!updatedUser) {
			throw new NotFoundException('User not found after registration');
		}

		const tokenInput: CreateTokenInput = {
			userId: updatedUser.id as string,
			email: updatedUser.email as string,
			address: (updatedUser.eth_address as string) ?? undefined,
		};

		const token = this.sessionService.createToken(tokenInput);

		return {
			token,
			userId: updatedUser.id as string,
			email: updatedUser.email as string,
			address: (updatedUser.eth_address as string) ?? undefined,
		};
	}

	/**
	 * Login Step 1: Get authentication challenge for existing user.
	 */
	async getLoginChallenge(email: string): Promise<{
		userId: string;
		authOptions: unknown;
	}> {
		const normalized = email.toLowerCase().trim();

		// Find user
		const { data: user } = await this.supabase.client
			.from('users')
			.select('id, status')
			.eq('email', normalized)
			.single();

		if (!user) {
			throw new NotFoundException('No account found with this email');
		}

		if ((user.status as string) !== 'active') {
			throw new BadRequestException('Account registration not complete. Please register first.');
		}

		const userId = user.id as string;

		// Get user's credentials
		const { data: credentials } = await this.supabase.client
			.from('passkey_credentials')
			.select('credential_id')
			.eq('user_id', userId);

		if (!credentials || credentials.length === 0) {
			throw new BadRequestException('No passkeys registered. Please register first.');
		}

		const allowIds = credentials.map((c) => c.credential_id as string);

		// Generate authentication challenge
		const authOptions = await generateAuthChallenge({
			rpId: this.config.RP_ID,
			allowCredentialIds: allowIds,
		});

		// Store challenge
		this.challengeStore.set(`auth:${normalized}`, authOptions.challenge);

		return { userId, authOptions };
	}

	/**
	 * Login Step 2: Verify authentication response — create session.
	 */
	async completePasskeyLogin(
		email: string,
		response: AuthenticationResponseJSON,
	): Promise<AuthResult> {
		const normalized = email.toLowerCase().trim();

		// Consume stored challenge (atomic get + delete)
		const expectedChallenge = this.challengeStore.consume(`auth:${normalized}`);
		if (!expectedChallenge) {
			throw new BadRequestException('Authentication challenge expired or not found');
		}

		// Find user
		const { data: user } = await this.supabase.client
			.from('users')
			.select('id, email, eth_address')
			.eq('email', normalized)
			.single();

		if (!user) {
			throw new NotFoundException('User not found');
		}

		// Find the credential used
		const { data: credential } = await this.supabase.client
			.from('passkey_credentials')
			.select('credential_id, public_key_cose, counter')
			.eq('user_id', user.id)
			.eq('credential_id', response.id)
			.single();

		if (!credential) {
			throw new UnauthorizedException('Unknown credential');
		}

		const publicKeyBytes = Buffer.from(credential.public_key_cose as string, 'base64');

		// Verify authentication
		const verified = await verifyAuthentication({
			response,
			expectedChallenge,
			credentialPublicKey: new Uint8Array(publicKeyBytes),
			credentialCounter: Number(credential.counter),
			credentialId: credential.credential_id as string,
			rpId: this.config.RP_ID,
			origin: this.config.ALLOWED_ORIGINS[0] ?? 'http://localhost:3000',
		});

		// Update counter
		await this.supabase.client
			.from('passkey_credentials')
			.update({ counter: verified.newCounter })
			.eq('credential_id', verified.credentialId);

		const tokenInput: CreateTokenInput = {
			userId: user.id as string,
			email: user.email as string,
			address: (user.eth_address as string) ?? undefined,
		};

		const token = this.sessionService.createToken(tokenInput);

		return {
			token,
			userId: user.id as string,
			email: user.email as string,
			address: (user.eth_address as string) ?? undefined,
		};
	}
}
