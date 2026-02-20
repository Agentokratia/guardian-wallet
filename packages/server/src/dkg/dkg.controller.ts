import { Body, Controller, ForbiddenException, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/authenticated-request.js';
import { SessionGuard } from '../common/session.guard.js';
import { SignerRepository } from '../signers/signer.repository.js';
import { DKGService } from './dkg.service.js';
import type { FinalizeDkgDto } from './dto/finalize-dkg.dto.js';
import type { InitDkgDto } from './dto/init-dkg.dto.js';

@Controller('dkg')
@UseGuards(SessionGuard)
export class DKGController {
	constructor(
		@Inject(DKGService) private readonly dkgService: DKGService,
		@Inject(SignerRepository) private readonly signerRepo: SignerRepository,
	) {}

	@Post('init')
	async init(@Body() body: InitDkgDto, @Req() req: AuthenticatedRequest) {
		await this.verifyOwnership(body.signerId, req);
		return this.dkgService.init(body);
	}

	@Post('finalize')
	async finalize(@Body() body: FinalizeDkgDto, @Req() req: AuthenticatedRequest) {
		await this.verifyOwnership(body.signerId, req);
		return this.dkgService.finalize(body);
	}

	private async verifyOwnership(signerId: string, req: AuthenticatedRequest): Promise<void> {
		const signer = await this.signerRepo.findById(signerId);
		if (!signer) return; // DKGService.init/finalize will throw NotFoundException
		if (req.sessionUser && signer.ownerAddress.toLowerCase() !== req.sessionUser.toLowerCase()) {
			throw new ForbiddenException('You do not own this signer');
		}
	}
}
