import { Controller, Get, Inject } from '@nestjs/common';
import { NetworkService } from './network.service.js';

@Controller('networks')
export class NetworkController {
	constructor(@Inject(NetworkService) private readonly networkService: NetworkService) {}

	@Get()
	async list() {
		return this.networkService.listEnabled();
	}
}
