import { Module, forwardRef } from '@nestjs/common';
import { SignerModule } from '../signers/signer.module.js';
import { AuxInfoPoolService } from './aux-info-pool.service.js';
import { DKGController } from './dkg.controller.js';
import { DKGService } from './dkg.service.js';

@Module({
	imports: [forwardRef(() => SignerModule)],
	providers: [AuxInfoPoolService, DKGService],
	controllers: [DKGController],
	exports: [AuxInfoPoolService, DKGService],
})
export class DKGModule {}
