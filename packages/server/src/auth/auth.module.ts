import { Global, Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { SignerModule } from '../signers/signer.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { ChallengeStore } from './challenge-store.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { SessionService } from './session.service.js';
import { TransferController } from './transfer.controller.js';
import { TransferService } from './transfer.service.js';

@Global()
@Module({
	imports: [
		JwtModule.registerAsync({
			inject: [APP_CONFIG],
			useFactory: (config: AppConfig) => ({
				secret: config.JWT_SECRET,
				signOptions: { expiresIn: Math.floor(config.JWT_EXPIRY_MS / 1000) },
			}),
		}),
		forwardRef(() => SignerModule),
	],
	providers: [ChallengeStore, SessionService, AuthService, RateLimitGuard, TransferService],
	controllers: [AuthController, TransferController],
	exports: [SessionService],
})
export class AuthModule {}
