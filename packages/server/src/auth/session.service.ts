import { createHash, randomBytes } from 'node:crypto';
import {
	Inject,
	Injectable,
	InternalServerErrorException,
	Logger,
	type OnModuleDestroy,
	type OnModuleInit,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SupabaseService } from '../common/supabase.service.js';

const REFRESH_TOKEN_TTL_MS = 7 * 86400 * 1000; // 7 days
const CLEANUP_INTERVAL_MS = 3600 * 1000; // 1 hour

export interface JwtPayload {
	sub: string;
	address?: string;
	email?: string;
	type: 'session';
	iat: number;
	exp: number;
}

export interface CreateTokenInput {
	userId: string;
	address?: string;
	email?: string;
}

@Injectable()
export class SessionService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(SessionService.name);
	private cleanupTimer!: ReturnType<typeof setInterval>;

	constructor(
		@Inject(JwtService) private readonly jwtService: JwtService,
		@Inject(SupabaseService) private readonly supabase: SupabaseService,
	) {}

	onModuleInit(): void {
		this.cleanupTimer = setInterval(() => this.cleanupExpiredTokens(), CLEANUP_INTERVAL_MS);
	}

	onModuleDestroy(): void {
		clearInterval(this.cleanupTimer);
	}

	private async cleanupExpiredTokens(): Promise<void> {
		const { error } = await this.supabase.client.rpc('cleanup_expired_refresh_tokens');
		if (error) {
			this.logger.error('Failed to cleanup expired refresh tokens', error.message);
		}
	}

	// ---------------------------------------------------------------------------
	// Access token — short-lived (15min), stateless verification via JwtService
	// ---------------------------------------------------------------------------

	createAccessToken(input: CreateTokenInput): string {
		return this.jwtService.sign({
			sub: input.userId,
			email: input.email,
			address: input.address,
			type: 'session',
		});
	}

	validateAccessToken(token: string): JwtPayload | null {
		try {
			const payload = this.jwtService.verify<JwtPayload>(token);
			// Defense-in-depth: only accept session tokens
			if (payload.type !== 'session') return null;
			return payload;
		} catch {
			return null;
		}
	}

	// ---------------------------------------------------------------------------
	// Refresh token — long-lived (7 days), DB-backed, opaque
	// ---------------------------------------------------------------------------

	async createRefreshToken(userId: string): Promise<string> {
		const token = randomBytes(32).toString('base64url');
		const hash = createHash('sha256').update(token).digest('hex');
		const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

		const { error } = await this.supabase.client.from('refresh_tokens').insert({
			user_id: userId,
			token_hash: hash,
			expires_at: expiresAt.toISOString(),
		});

		if (error) {
			this.logger.error('Failed to create refresh token', error.message);
			throw new InternalServerErrorException('Failed to create session');
		}

		return token;
	}

	async validateRefreshToken(token: string): Promise<{ userId: string } | null> {
		const hash = createHash('sha256').update(token).digest('hex');
		const { data, error } = await this.supabase.client
			.from('refresh_tokens')
			.select('id, user_id, expires_at')
			.eq('token_hash', hash)
			.is('revoked_at', null)
			.single();

		if (error || !data) return null;
		if (new Date(data.expires_at as string) < new Date()) return null;

		return { userId: data.user_id as string };
	}

	/**
	 * Rotation: revoke old refresh token, issue new one.
	 * Prevents replay — each refresh token is single-use.
	 */
	async rotateRefreshToken(oldToken: string): Promise<{ userId: string; newToken: string } | null> {
		const hash = createHash('sha256').update(oldToken).digest('hex');

		const { data } = await this.supabase.client
			.from('refresh_tokens')
			.update({ revoked_at: new Date().toISOString() })
			.eq('token_hash', hash)
			.is('revoked_at', null)
			.gte('expires_at', new Date().toISOString())
			.select('user_id')
			.single();

		if (!data) return null;

		const userId = data.user_id as string;
		const newToken = await this.createRefreshToken(userId);
		return { userId, newToken };
	}

	/** Revoke ALL refresh tokens for a user (logout). */
	async revokeAllTokens(userId: string): Promise<void> {
		const { error } = await this.supabase.client
			.from('refresh_tokens')
			.update({ revoked_at: new Date().toISOString() })
			.eq('user_id', userId)
			.is('revoked_at', null);

		if (error) {
			this.logger.error(`Failed to revoke tokens for user ${userId}`, error.message);
		}
	}

	// ---------------------------------------------------------------------------
	// Backward-compat aliases — guards call these
	// ---------------------------------------------------------------------------

	createToken(input: CreateTokenInput): string {
		return this.createAccessToken(input);
	}

	validateToken(token: string): JwtPayload | null {
		return this.validateAccessToken(token);
	}
}
