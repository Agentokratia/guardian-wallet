import { Module } from '@nestjs/common';
import { SignerModule } from '../signers/signer.module.js';
import { DKGController } from './dkg.controller.js';
import { DKGService } from './dkg.service.js';

@Module({
	imports: [SignerModule],
	providers: [DKGService],
	controllers: [DKGController],
})
export class DKGModule {}
