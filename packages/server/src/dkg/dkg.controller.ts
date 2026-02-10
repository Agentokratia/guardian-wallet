import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../common/session.guard.js';
import { DKGService } from './dkg.service.js';
import { FinalizeDkgDto } from './dto/finalize-dkg.dto.js';
import { InitDkgDto } from './dto/init-dkg.dto.js';

@Controller('dkg')
@UseGuards(SessionGuard)
export class DKGController {
	constructor(@Inject(DKGService) private readonly dkgService: DKGService) {}

	@Post('init')
	async init(@Body() body: InitDkgDto) {
		return this.dkgService.init(body);
	}

	@Post('finalize')
	async finalize(@Body() body: FinalizeDkgDto) {
		return this.dkgService.finalize(body);
	}
}
