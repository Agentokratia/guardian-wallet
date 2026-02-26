import {
	BadRequestException,
	Body,
	Controller,
	Get,
	HttpException,
	HttpStatus,
	Inject,
	Post,
	Req,
	Res,
	UnauthorizedException,
	UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../common/authenticated-request.js';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { SessionGuard } from '../common/session.guard.js';
import { AuthService } from './auth.service.js';
import {
	LoginDto,
	PasskeyLoginChallengeDto,
	PasskeyLoginVerifyDto,
	PasskeySetupCompleteDto,
	RefreshDto,
	VerifyOTPDto,
} from './dto/auth.dto.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { SessionService } from './session.service.js';

const REFRESH_TOKEN_MAX_AGE_MS = 7 * 86400 * 1000; // 7 days

/**
 * Detect CLI clients by absence of the Origin header.
 * Browsers ALWAYS send Origin on POST requests (CORS spec); browser JS cannot remove it.
 * CLI tools (Node.js fetch, curl) do NOT send Origin by default.
 * This is not spoofable via XSS — unlike a custom header which any fetch() can add.
 */
function isCLIRequest(req: Request): boolean {
	return !req.headers.origin;
}

@Controller('auth')
@UseGuards(RateLimitGuard)
export class AuthController {
	constructor(
		@Inject(APP_CONFIG) private readonly config: AppConfig,
		@Inject(AuthService) private readonly authService: AuthService,
		@Inject(SessionService) private readonly sessionService: SessionService,
		@Inject(RateLimitGuard) private readonly rateLimitGuard: RateLimitGuard,
	) {}

	/**
	 * Login — checks user, sends OTP only when needed.
	 * If user has a passkey: returns { hasPasskey: true }, no OTP sent.
	 * If new user or no passkey: creates user if needed, sends OTP.
	 * Pass sendOtp: true to force OTP (e.g. "Use email code instead" fallback).
	 */
	@Post('login')
	async login(@Body() body: LoginDto) {
		const result = await this.authService.loginOrRegister(body.email, { sendOtp: body.sendOtp });
		// Only return hasPasskey (needed for UI flow). Don't leak userId or isNewUser.
		return { hasPasskey: result.hasPasskey };
	}

	/**
	 * Verify OTP → issue JWT access + refresh tokens.
	 * Dashboard: sets HttpOnly cookies (tokens NOT in body).
	 * CLI: returns tokens in response body.
	 */
	@Post('verify-otp')
	async verifyOTP(
		@Body() body: VerifyOTPDto,
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response,
	) {
		// Defense-in-depth lockout check (guard already checks, but depends on body parsing)
		if (this.rateLimitGuard.isLockedOut(body.email)) {
			throw new HttpException(
				'Account temporarily locked. Try again later.',
				HttpStatus.TOO_MANY_REQUESTS,
			);
		}

		try {
			const result = await this.authService.verifyOTPAndLogin(body.email, body.code);

			// Reset failure counter on success
			this.rateLimitGuard.recordVerifySuccess(body.email);

			// Issue refresh token and build response
			const refreshToken = await this.sessionService.createRefreshToken(result.userId);
			return this.issueSessionResponse(req, res, {
				token: result.token,
				refreshToken,
				userId: result.userId,
				email: result.email,
				address: result.address,
			});
		} catch (error) {
			// Only count wrong-code attempts toward lockout, not infra errors
			if (error instanceof BadRequestException) {
				this.rateLimitGuard.recordVerifyFailure(body.email);
			}
			throw error;
		}
	}

	/**
	 * Get passkey registration options (optional, for dashboard signing).
	 * User must be logged in via OTP first.
	 */
	@Post('passkey/setup-challenge')
	@UseGuards(SessionGuard)
	async passkeySetupChallenge(@Req() req: AuthenticatedRequest) {
		const userId = requireSessionUserId(req);
		const result = await this.authService.getPasskeySetupChallenge(userId);
		return { registrationOptions: result.registrationOptions };
	}

	/**
	 * Complete passkey registration.
	 * User must be logged in via OTP first.
	 */
	@Post('passkey/setup-complete')
	@UseGuards(SessionGuard)
	async passkeySetupComplete(
		@Body() body: PasskeySetupCompleteDto,
		@Req() req: AuthenticatedRequest,
	) {
		const userId = requireSessionUserId(req);
		const result = await this.authService.completePasskeySetup(
			userId,
			body.response as unknown as Parameters<AuthService['completePasskeySetup']>[1],
			body.prfDerivedAddress,
		);
		return { credentialId: result.credentialId };
	}

	/**
	 * Get passkey authentication challenge — returns credential IDs so
	 * the browser auto-selects the right passkey (no picker dialog).
	 */
	@Post('passkey/auth-challenge')
	@UseGuards(SessionGuard)
	async passkeyAuthChallenge(@Req() req: AuthenticatedRequest) {
		const userId = requireSessionUserId(req);
		const result = await this.authService.getPasskeyAuthChallenge(userId);
		return { authOptions: result.authOptions };
	}

	/**
	 * Get passkey login challenge — unauthenticated.
	 * Returns WebAuthn challenge so the browser can trigger Touch ID.
	 */
	@Post('passkey/login-challenge')
	async passkeyLoginChallenge(@Body() body: PasskeyLoginChallengeDto) {
		const result = await this.authService.getPasskeyLoginChallenge(body.email);
		return { authOptions: result.authOptions };
	}

	/**
	 * Verify passkey login — unauthenticated.
	 * Validates WebAuthn assertion, issues JWT + refresh token, sets session cookies.
	 */
	@Post('passkey/login-verify')
	async passkeyLoginVerify(
		@Body() body: PasskeyLoginVerifyDto,
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response,
	) {
		// Defense-in-depth lockout check
		if (this.rateLimitGuard.isLockedOut(body.email)) {
			throw new HttpException(
				'Account temporarily locked. Try again later.',
				HttpStatus.TOO_MANY_REQUESTS,
			);
		}

		try {
			const result = await this.authService.verifyPasskeyLogin(body.email, body.response);

			// Reset failure counter on success
			this.rateLimitGuard.recordVerifySuccess(body.email);

			// Issue refresh token and build response
			const refreshToken = await this.sessionService.createRefreshToken(result.userId);
			return this.issueSessionResponse(req, res, {
				token: result.token,
				refreshToken,
				userId: result.userId,
				email: result.email,
				address: result.address,
			});
		} catch (error) {
			// Only count wrong-credential attempts toward lockout, not infra errors
			if (error instanceof BadRequestException) {
				this.rateLimitGuard.recordVerifyFailure(body.email);
			}
			throw error;
		}
	}

	/**
	 * Refresh — rotate refresh token, issue new access + refresh tokens.
	 * Dashboard: reads refresh token from cookie, sets new cookies.
	 * CLI: reads refreshToken from body, returns new tokens in body.
	 */
	@Post('refresh')
	async refresh(
		@Body() body: RefreshDto,
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response,
	) {
		const refreshToken =
			(req as unknown as { cookies?: Record<string, string> }).cookies?.refresh ||
			body.refreshToken;

		if (!refreshToken) {
			throw new UnauthorizedException('Missing refresh token');
		}

		const result = await this.sessionService.rotateRefreshToken(refreshToken);
		if (!result) {
			throw new UnauthorizedException('Invalid or expired refresh token');
		}

		// Look up user for access token claims
		const user = await this.authService.getUserProfile(result.userId);
		if (!user) {
			throw new UnauthorizedException('User account no longer exists');
		}

		const accessToken = this.sessionService.createAccessToken({
			userId: result.userId,
			email: user.email,
			address: user.address,
		});

		return this.issueSessionResponse(req, res, {
			token: accessToken,
			refreshToken: result.newToken,
			userId: result.userId,
			email: user.email,
			address: user.address,
		});
	}

	@Post('logout')
	async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
		let revoked = false;

		// Try access token first to identify user
		const token =
			(req as unknown as { cookies?: Record<string, string> }).cookies?.session ||
			(
				req as unknown as { headers: Record<string, string | undefined> }
			).headers.authorization?.replace(/^bearer\s+/i, '');
		if (token) {
			const payload = this.sessionService.validateToken(token);
			if (payload) {
				await this.sessionService.revokeAllTokens(payload.sub);
				revoked = true;
			}
		}

		// Fallback: use refresh token to identify user when access token is expired
		if (!revoked) {
			const refreshToken =
				(req as unknown as { cookies?: Record<string, string> }).cookies?.refresh ||
				(req.body as { refreshToken?: string } | undefined)?.refreshToken;
			if (refreshToken) {
				const result = await this.sessionService.validateRefreshToken(refreshToken);
				if (result) {
					await this.sessionService.revokeAllTokens(result.userId);
				}
			}
		}

		// Clear both cookies
		const cookieOpts = {
			httpOnly: true,
			sameSite: 'strict' as const,
			secure: this.config.NODE_ENV !== 'development',
		};

		res.clearCookie('session', { ...cookieOpts, path: '/' });
		res.clearCookie('refresh', { ...cookieOpts, path: '/api/v1/auth/' });

		return { success: true };
	}

	@Get('me')
	@UseGuards(SessionGuard)
	async me(@Req() req: AuthenticatedRequest) {
		const userId = requireSessionUserId(req);
		const user = await this.authService.getUserProfile(userId);
		return {
			email: user?.email ?? req.sessionEmail,
			userId,
			address: user?.address,
			hasPasskey: user?.hasPasskey ?? false,
		};
	}

	/**
	 * Shared response builder for all auth endpoints that issue sessions.
	 * Sets HttpOnly cookies for browsers, includes tokens in body for CLI.
	 */
	private issueSessionResponse(
		req: Request,
		res: Response,
		auth: { token: string; refreshToken: string; userId: string; email?: string; address?: string },
	): Record<string, unknown> {
		this.setAccessCookie(res, auth.token);
		this.setRefreshCookie(res, auth.refreshToken);

		const isCli = isCLIRequest(req);
		return {
			...(isCli ? { token: auth.token, refreshToken: auth.refreshToken } : {}),
			userId: auth.userId,
			email: auth.email,
			address: auth.address,
		};
	}

	private setAccessCookie(res: Response, token: string): void {
		res.cookie('session', token, {
			httpOnly: true,
			sameSite: 'strict',
			secure: this.config.NODE_ENV !== 'development',
			path: '/',
			maxAge: this.config.JWT_EXPIRY_MS,
		});
	}

	private setRefreshCookie(res: Response, token: string): void {
		res.cookie('refresh', token, {
			httpOnly: true,
			sameSite: 'strict',
			secure: this.config.NODE_ENV !== 'development',
			path: '/api/v1/auth/',
			maxAge: REFRESH_TOKEN_MAX_AGE_MS,
		});
	}
}

/** Extract session user ID or throw 401. Guards should catch this first, but defense-in-depth. */
function requireSessionUserId(req: AuthenticatedRequest): string {
	if (!req.sessionUserId) {
		throw new UnauthorizedException('Session user ID not available');
	}
	return req.sessionUserId;
}
