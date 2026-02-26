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
	ForbiddenException,
	Inject,
	Injectable,
	InternalServerErrorException,
	Logger,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common';
import type { RegistrationResponseJSON } from '@simplewebauthn/types';
import { Resend } from 'resend';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { SupabaseService } from '../common/supabase.service.js';
import { ChallengeStore } from './challenge-store.js';
import type { CreateTokenInput } from './session.service.js';
import { SessionService } from './session.service.js';
import { renderOtpEmail } from './templates/otp-email.js';

export interface AuthResult {
	token: string;
	userId: string;
	email: string;
	address?: string;
}

@Injectable()
export class AuthService {
	private readonly logger = new Logger(AuthService.name);
	private readonly resend: Resend | null;

	/** Fail-closed status check — only explicitly allowed statuses pass.
	 *  Adding a new user status? Add it here if it should be able to authenticate. */
	private static readonly ACTIVE_STATUSES = new Set(['active', 'registered', 'pending_passkey']);
	private isUserDisabled(status: unknown): boolean {
		return !AuthService.ACTIVE_STATUSES.has(status as string);
	}

	constructor(
		@Inject(ChallengeStore) private readonly challengeStore: ChallengeStore,
		@Inject(SessionService) private readonly sessionService: SessionService,
		@Inject(SupabaseService) private readonly supabase: SupabaseService,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
	) {
		this.resend = config.EMAIL_PROVIDER === 'resend' ? new Resend(config.RESEND_API_KEY) : null;
	}

	/**
	 * Unified login — create user if new, conditionally send OTP.
	 * If user has a passkey and sendOtp is not true: skip OTP, just return hasPasskey.
	 * Pass sendOtp: true to force OTP (e.g. "Use email code instead" fallback).
	 */
	async loginOrRegister(
		email: string,
		options?: { sendOtp?: boolean },
	): Promise<{ userId: string; isNewUser: boolean; hasPasskey: boolean }> {
		const normalized = email.toLowerCase().trim();
		if (!normalized || !normalized.includes('@')) {
			throw new BadRequestException('Invalid email address');
		}

		let userId: string;
		let isNewUser = false;
		let hasPasskey = false;

		const { data: existing } = await this.supabase.client
			.from('users')
			.select('id, status, has_passkey')
			.eq('email', normalized)
			.single();

		if (existing) {
			if (this.isUserDisabled(existing.status)) {
				throw new ForbiddenException('Account is disabled');
			}
			userId = existing.id as string;
			hasPasskey = Boolean(existing.has_passkey);
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
						.select('id, status')
						.eq('email', normalized)
						.single();
					if (!raceUser) {
						throw new InternalServerErrorException('Failed to resolve user after race');
					}
					if (this.isUserDisabled((raceUser as { status: string }).status)) {
						throw new ForbiddenException('Account is disabled');
					}
					userId = (raceUser as { id: string }).id;
				} else {
					throw error;
				}
			} else {
				userId = (created as { id: string }).id;
				isNewUser = true;
			}
		}

		// Passkey users: skip OTP unless explicitly requested (e.g. "Use email code" fallback)
		if (hasPasskey && !options?.sendOtp) {
			return { userId, isNewUser, hasPasskey };
		}

		// Generate and store OTP
		const otp = generateOTP();
		const otpHash = createHash('sha256').update(otp.code).digest('hex');

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
		if (this.resend) {
			const emailContent = renderOtpEmail(otp.code);
			const { error: sendError } = await this.resend.emails.send({
				from: 'Guardian Wallet <noreply@agentokratia.com>',
				to: normalized,
				subject: emailContent.subject,
				text: emailContent.text,
				html: emailContent.html,
			});
			if (sendError) {
				this.logger.error(`Failed to send OTP email: ${JSON.stringify(sendError)}`);
				throw new InternalServerErrorException('Failed to send verification email');
			}
		} else if (this.config.NODE_ENV === 'development' || this.config.NODE_ENV === 'test') {
			this.logger.warn(`[DEV] OTP for ${normalized}: ${otp.code}`);
		} else {
			this.logger.error('EMAIL_PROVIDER not configured — OTP not sent');
			throw new InternalServerErrorException('Email service not configured');
		}

		return { userId, isNewUser, hasPasskey };
	}

	/**
	 * Verify OTP and issue JWT session token directly.
	 * No passkey required — user goes straight to 'active' status.
	 * Replaces verifyEmailOTP() + completePasskeyRegistration() for login.
	 */
	async verifyOTPAndLogin(email: string, code: string): Promise<AuthResult> {
		if (!/^\d{6}$/.test(code)) {
			throw new BadRequestException('Invalid code format — expected 6 digits');
		}

		const normalized = email.toLowerCase().trim();

		const { data: user } = await this.supabase.client
			.from('users')
			.select('id, status, eth_address')
			.eq('email', normalized)
			.single();

		if (!user) {
			throw new NotFoundException('User not found');
		}

		if (this.isUserDisabled(user.status)) {
			throw new ForbiddenException('Account is disabled');
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

		// Mark OTP as used — atomic: only succeeds if still unused (prevents race)
		const { data: updatedRows } = await this.supabase.client
			.from('email_verifications')
			.update({ is_used: true })
			.eq('id', otpRecord.id)
			.eq('is_used', false)
			.select('id');

		if (!updatedRows || updatedRows.length === 0) {
			throw new ConflictException('Verification code already used');
		}

		// Set user to active (skip pending_passkey state entirely)
		await this.supabase.client
			.from('users')
			.update({
				email_verified: true,
				status: 'active',
				updated_at: new Date().toISOString(),
			})
			.eq('id', userId);

		// Issue JWT
		const tokenInput: CreateTokenInput = {
			userId,
			email: normalized,
			address: (user.eth_address as string) ?? undefined,
		};

		const token = this.sessionService.createToken(tokenInput);

		return {
			token,
			userId,
			email: normalized,
			address: (user.eth_address as string) ?? undefined,
		};
	}

	/**
	 * Get passkey setup challenge for optional passkey registration (for signing).
	 * Only available to authenticated (logged in) users.
	 */
	async getPasskeySetupChallenge(userId: string): Promise<{ registrationOptions: unknown }> {
		const { data: user } = await this.supabase.client
			.from('users')
			.select('id, email')
			.eq('id', userId)
			.single();

		if (!user) {
			throw new NotFoundException('User not found');
		}

		const userEmail = user.email as string;

		// Get existing credentials to exclude
		const { data: existingCreds } = await this.supabase.client
			.from('passkey_credentials')
			.select('credential_id')
			.eq('user_id', userId);

		const excludeIds = existingCreds?.map((c) => c.credential_id as string) ?? [];

		const registrationOptions = await generateRegistrationChallenge({
			rpId: this.config.RP_ID,
			rpName: this.config.RP_NAME,
			userId,
			userName: userEmail,
			userDisplayName: userEmail.split('@')[0] ?? userEmail,
			excludeCredentialIds: excludeIds,
		});

		// Store challenge for verification (uses setup: prefix)
		this.challengeStore.set(`setup:${userId}`, registrationOptions.challenge);

		return { registrationOptions };
	}

	/**
	 * Complete optional passkey registration — stores credential, sets has_passkey.
	 * Does NOT create a new session — user is already logged in via OTP.
	 */
	async completePasskeySetup(
		userId: string,
		response: RegistrationResponseJSON,
		prfDerivedAddress?: string,
	): Promise<{ credentialId: string }> {
		// Consume stored challenge (atomic get + delete)
		const expectedChallenge = this.challengeStore.consume(`setup:${userId}`);
		if (!expectedChallenge) {
			throw new BadRequestException('Registration challenge expired or not found');
		}

		const verified = await verifyRegistration(
			response,
			expectedChallenge,
			this.config.RP_ID,
			this.config.ALLOWED_ORIGINS,
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

		// Update user: set has_passkey, optionally set PRF-derived address
		const updateData: Record<string, unknown> = {
			has_passkey: true,
			updated_at: new Date().toISOString(),
		};
		if (prfDerivedAddress) {
			updateData.eth_address = prfDerivedAddress.toLowerCase();
		}

		await this.supabase.client.from('users').update(updateData).eq('id', userId);

		return { credentialId: verified.credentialId };
	}

	/**
	 * Get passkey authentication challenge — returns the user's credential IDs
	 * so the browser auto-selects the right passkey (no picker dialog).
	 *
	 * NOTE: The authentication response is NOT verified server-side.
	 * The PRF derivation itself proves passkey possession — if share
	 * decryption succeeds, the user had the passkey.
	 */
	async getPasskeyAuthChallenge(userId: string): Promise<{ authOptions: unknown }> {
		const { data: creds } = await this.supabase.client
			.from('passkey_credentials')
			.select('credential_id')
			.eq('user_id', userId);

		const allowIds = creds?.map((c) => c.credential_id as string) ?? [];
		if (allowIds.length === 0) {
			throw new BadRequestException('No passkey registered. Set up a passkey first.');
		}

		const authOptions = await generateAuthChallenge({
			rpId: this.config.RP_ID,
			allowCredentialIds: allowIds,
		});

		this.challengeStore.set(`auth:${userId}`, authOptions.challenge);

		return { authOptions };
	}

	/**
	 * Get passkey login challenge — unauthenticated endpoint.
	 * Returns WebAuthn challenge with the user's credential IDs so the browser
	 * auto-selects the right passkey (no picker dialog).
	 */
	async getPasskeyLoginChallenge(email: string): Promise<{ authOptions: unknown }> {
		const normalized = email.toLowerCase().trim();

		const { data: user } = await this.supabase.client
			.from('users')
			.select('id, status, has_passkey')
			.eq('email', normalized)
			.single();

		if (!user || !user.has_passkey) {
			throw new BadRequestException('Authentication failed');
		}
		if (this.isUserDisabled(user.status)) {
			// Same generic error — don't leak account status to unauthenticated callers
			throw new BadRequestException('Authentication failed');
		}

		const userId = user.id as string;

		const { data: creds } = await this.supabase.client
			.from('passkey_credentials')
			.select('credential_id')
			.eq('user_id', userId);

		const allowIds = creds?.map((c) => c.credential_id as string) ?? [];
		if (allowIds.length === 0) {
			throw new BadRequestException('Authentication failed');
		}

		const authOptions = await generateAuthChallenge({
			rpId: this.config.RP_ID,
			allowCredentialIds: allowIds,
		});

		this.challengeStore.set(`login:${normalized}`, authOptions.challenge);

		return { authOptions };
	}

	/**
	 * Verify passkey login — unauthenticated endpoint.
	 * Validates WebAuthn assertion, updates counter (replay protection), issues JWT.
	 */
	async verifyPasskeyLogin(email: string, response: Record<string, unknown>): Promise<AuthResult> {
		const normalized = email.toLowerCase().trim();

		// Consume challenge (atomic get + delete — one-time use)
		const expectedChallenge = this.challengeStore.consume(`login:${normalized}`);
		if (!expectedChallenge) {
			throw new BadRequestException('Authentication failed');
		}

		// Look up user
		const { data: user } = await this.supabase.client
			.from('users')
			.select('id, status, eth_address')
			.eq('email', normalized)
			.single();

		if (!user) {
			throw new BadRequestException('Authentication failed');
		}
		if (this.isUserDisabled(user.status)) {
			// Same generic error — don't leak account status to unauthenticated callers
			throw new BadRequestException('Authentication failed');
		}

		const userId = user.id as string;

		// Get credential ID from the response to look up the right public key
		const credentialId = (response as { id?: string }).id;
		if (!credentialId) {
			throw new BadRequestException('Authentication failed');
		}

		// Fetch credential's public key and counter
		const { data: cred } = await this.supabase.client
			.from('passkey_credentials')
			.select('credential_id, public_key_cose, counter')
			.eq('user_id', userId)
			.eq('credential_id', credentialId)
			.single();

		if (!cred) {
			throw new BadRequestException('Authentication failed');
		}

		// Verify the WebAuthn assertion
		const verified = await verifyAuthentication({
			response: response as unknown as Parameters<typeof verifyAuthentication>[0]['response'],
			expectedChallenge,
			credentialPublicKey: Buffer.from(cred.public_key_cose as string, 'base64'),
			credentialCounter: cred.counter as number,
			credentialId: cred.credential_id as string,
			rpId: this.config.RP_ID,
			origin: this.config.ALLOWED_ORIGINS,
		});

		// Update counter in DB (replay protection)
		await this.supabase.client
			.from('passkey_credentials')
			.update({ counter: verified.newCounter })
			.eq('credential_id', verified.credentialId)
			.eq('user_id', userId);

		// Issue JWT
		const token = this.sessionService.createToken({
			userId,
			email: normalized,
			address: (user.eth_address as string) ?? undefined,
		});

		return {
			token,
			userId,
			email: normalized,
			address: (user.eth_address as string) ?? undefined,
		};
	}

	async getUserProfile(
		userId: string,
	): Promise<{ email?: string; address?: string; hasPasskey: boolean } | null> {
		const { data } = await this.supabase.client
			.from('users')
			.select('email, eth_address, has_passkey')
			.eq('id', userId)
			.single();

		if (!data) return null;

		return {
			email: (data.email as string) || undefined,
			address: (data.eth_address as string) || undefined,
			hasPasskey: Boolean(data.has_passkey),
		};
	}
}
