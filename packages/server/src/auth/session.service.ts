import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../common/config.js';

export interface JwtPayload {
	sub: string;
	address?: string;
	email?: string;
	iat: number;
	exp: number;
}

export interface CreateTokenInput {
	userId: string;
	address?: string;
	email?: string;
}

@Injectable()
export class SessionService {
	constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

	createToken(input: CreateTokenInput | string): string {
		const now = Math.floor(Date.now() / 1000);
		const expiresIn = this.parseExpiry(this.config.JWT_EXPIRY);

		const header = { alg: 'HS256', typ: 'JWT' };

		// Support both old string-based (backward compat) and new object-based input
		const payload: JwtPayload =
			typeof input === 'string'
				? { sub: input, iat: now, exp: now + expiresIn }
				: {
						sub: input.userId,
						address: input.address,
						email: input.email,
						iat: now,
						exp: now + expiresIn,
					};

		const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
		const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');

		const signature = createHmac('sha256', this.config.JWT_SECRET)
			.update(`${headerB64}.${payloadB64}`)
			.digest('base64url');

		return `${headerB64}.${payloadB64}.${signature}`;
	}

	validateToken(token: string): JwtPayload | null {
		try {
			const parts = token.split('.');
			if (parts.length !== 3) return null;

			const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

			const expected = createHmac('sha256', this.config.JWT_SECRET)
				.update(`${headerB64}.${payloadB64}`)
				.digest('base64url');

			const expectedBuf = Buffer.from(expected, 'utf-8');
			const actualBuf = Buffer.from(signatureB64, 'utf-8');
			if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
				return null;
			}

			const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as JwtPayload;

			if (payload.exp * 1000 < Date.now()) return null;

			return payload;
		} catch {
			return null;
		}
	}

	getExpirySeconds(): number {
		return this.parseExpiry(this.config.JWT_EXPIRY);
	}

	private parseExpiry(expiry: string): number {
		const match = expiry.match(/^(\d+)([smhd])$/);
		if (!match) {
			const hours = Number.parseInt(expiry, 10);
			if (!Number.isNaN(hours)) return hours * 3600;
			return 86400;
		}

		const value = Number.parseInt(match[1] as string, 10);
		const unit = match[2];

		switch (unit) {
			case 's':
				return value;
			case 'm':
				return value * 60;
			case 'h':
				return value * 3600;
			case 'd':
				return value * 86400;
			default:
				return 86400;
		}
	}
}
