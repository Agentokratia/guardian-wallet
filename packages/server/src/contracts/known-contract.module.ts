import { Module } from '@nestjs/common';
import { KnownContractController } from './known-contract.controller.js';
import { KnownContractRepository } from './known-contract.repository.js';

@Module({
	controllers: [KnownContractController],
	providers: [KnownContractRepository],
	exports: [KnownContractRepository],
})
export class KnownContractModule {}
