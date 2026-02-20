import {
	Body,
	Controller,
	Get,
	Inject,
	Post,
	Req,
	Res,
	UnauthorizedException,
	UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../common/authenticated-request.js';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { hashApiKey, timingSafeCompare } from '../common/crypto-utils.js';
import { SessionGuard } from '../common/session.guard.js';
import { SignerRepository } from '../signers/signer.repository.js';
import { AuthService } from './auth.service.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { SessionService } from './session.service.js';

@Controller('auth')
@UseGuards(RateLimitGuard)
export class AuthController {
	constructor(
		@Inject(APP_CONFIG) private readonly config: AppConfig,
		@Inject(AuthService) private readonly authService: AuthService,
		@Inject(SessionService) private readonly sessionService: SessionService,
		@Inject(SignerRepository) private readonly signerRepo: SignerRepository,
	) {}

	/**
	 * Start registration: send OTP to email.
	 */
	@Post('register')
	async register(@Body() body: { email: string }) {
		const result = await this.authService.registerEmail(body.email);
		return { userId: result.userId, isNewUser: result.isNewUser };
	}

	/**
	 * Verify email OTP → return passkey registration options.
	 */
	@Post('verify-email')
	async verifyEmail(@Body() body: { email: string; code: string }) {
		const result = await this.authService.verifyEmailOTP(body.email, body.code);
		return {
			userId: result.userId,
			registrationOptions: result.registrationOptions,
		};
	}

	/**
	 * Complete passkey registration → set session cookie.
	 */
	@Post('passkey/register')
	async passkeyRegister(
		@Body() body: { userId: string; response: unknown; prfDerivedAddress?: string },
		@Res({ passthrough: true }) res: Response,
	) {
		const result = await this.authService.completePasskeyRegistration(
			body.userId,
			body.response as Parameters<AuthService['completePasskeyRegistration']>[1],
			body.prfDerivedAddress,
		);

		this.setSessionCookie(res, result.token);

		return { email: result.email, address: result.address, userId: result.userId };
	}

	/**
	 * Get authentication challenge for login.
	 */
	@Post('passkey/login-challenge')
	async loginChallenge(@Body() body: { email: string }) {
		const result = await this.authService.getLoginChallenge(body.email);
		return { userId: result.userId, authOptions: result.authOptions };
	}

	/**
	 * Verify passkey login → set session cookie.
	 */
	@Post('passkey/login')
	async passkeyLogin(
		@Body() body: { email: string; response: unknown },
		@Res({ passthrough: true }) res: Response,
	) {
		const result = await this.authService.completePasskeyLogin(
			body.email,
			body.response as Parameters<AuthService['completePasskeyLogin']>[1],
		);

		this.setSessionCookie(res, result.token);

		return { email: result.email, address: result.address, userId: result.userId };
	}

	/**
	 * Exchange X-Admin-Token (singleHash) for a short-lived admin JWT (5 min).
	 * Limits replay window — the raw hash is only sent once per session.
	 */
	@Post('admin-token')
	async adminToken(@Body() body: { signerId: string; adminToken: string; ttl?: number }) {
		if (!body.signerId || !body.adminToken) {
			throw new UnauthorizedException('Missing signerId or adminToken');
		}

		const doubleHash = hashApiKey(body.adminToken);
		const signer = await this.signerRepo.findById(body.signerId);

		// Same error for missing signer and wrong credential — don't leak signer existence
		if (!signer || !timingSafeCompare(signer.ownerAddress, `sha256:${doubleHash}`)) {
			throw new UnauthorizedException('Invalid credential');
		}

		return this.sessionService.createAdminToken(signer.id, body.ttl);
	}

	@Post('logout')
	async logout(@Res({ passthrough: true }) res: Response) {
		res.clearCookie('session', {
			httpOnly: true,
			sameSite: 'lax',
			secure: this.config.NODE_ENV === 'production',
			path: '/',
		});

		return { success: true };
	}

	@Get('me')
	@UseGuards(SessionGuard)
	async me(@Req() req: AuthenticatedRequest) {
		return {
			address: req.sessionUser,
			email: req.sessionEmail,
			userId: req.sessionUserId,
		};
	}

	private setSessionCookie(res: Response, token: string): void {
		const maxAge = this.sessionService.getExpirySeconds();
		res.cookie('session', token, {
			httpOnly: true,
			sameSite: 'lax',
			secure: this.config.NODE_ENV === 'production',
			path: '/',
			maxAge: maxAge * 1000,
		});
	}
}
