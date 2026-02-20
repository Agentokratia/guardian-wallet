import { Module, forwardRef } from '@nestjs/common';
import { DKGModule } from '../dkg/dkg.module.js';
import { TokenModule } from '../tokens/token.module.js';
import { SignerController } from './signer.controller.js';
import { SignerRepository } from './signer.repository.js';
import { SignerService } from './signer.service.js';

@Module({
	imports: [TokenModule, forwardRef(() => DKGModule)],
	providers: [SignerRepository, SignerService],
	controllers: [SignerController],
	exports: [SignerRepository, SignerService],
})
export class SignerModule {}
