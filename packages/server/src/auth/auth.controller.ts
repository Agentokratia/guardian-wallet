import { Body, Controller, Get, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../common/authenticated-request.js';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { SessionGuard } from '../common/session.guard.js';
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
	) {}

	@Get('nonce')
	async getNonce() {
		const nonce = this.authService.generateNonce();
		return { nonce };
	}

	@Post('wallet/verify')
	async walletVerify(
		@Body() body: { message: string; signature: string },
		@Res({ passthrough: true }) res: Response,
	) {
		const result = await this.authService.verifyWalletSignature(
			body.message,
			body.signature,
		);

		const maxAge = this.sessionService.getExpirySeconds();

		res.cookie('session', result.token, {
			httpOnly: true,
			sameSite: 'lax',
			secure: this.config.NODE_ENV === 'production',
			path: '/',
			maxAge: maxAge * 1000,
		});

		return { verified: result.verified, address: result.address };
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
		return { address: req.sessionUser };
	}
}
