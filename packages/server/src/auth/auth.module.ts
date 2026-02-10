import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { ChallengeStore } from './challenge-store.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { SessionService } from './session.service.js';

@Global()
@Module({
	providers: [ChallengeStore, SessionService, AuthService, RateLimitGuard],
	controllers: [AuthController],
	exports: [SessionService],
})
export class AuthModule {}
