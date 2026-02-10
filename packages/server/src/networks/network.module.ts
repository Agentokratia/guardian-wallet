import { Global, Module } from '@nestjs/common';
import { NetworkController } from './network.controller.js';
import { NetworkRepository } from './network.repository.js';
import { NetworkService } from './network.service.js';

@Global()
@Module({
	providers: [NetworkRepository, NetworkService],
	controllers: [NetworkController],
	exports: [NetworkService],
})
export class NetworkModule {}
