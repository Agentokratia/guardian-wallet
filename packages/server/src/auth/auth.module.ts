import { Global, Module, forwardRef } from '@nestjs/common';
import { SignerModule } from '../signers/signer.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { ChallengeStore } from './challenge-store.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { SessionService } from './session.service.js';

@Global()
@Module({
	imports: [forwardRef(() => SignerModule)],
	providers: [ChallengeStore, SessionService, AuthService, RateLimitGuard],
	controllers: [AuthController],
	exports: [SessionService],
})
export class AuthModule {}
