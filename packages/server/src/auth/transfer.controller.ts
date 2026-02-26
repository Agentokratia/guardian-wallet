import {
	Body,
	Controller,
	Get,
	Inject,
	Param,
	ParseUUIDPipe,
	Patch,
	Post,
	Query,
	Req,
	UnauthorizedException,
	UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/authenticated-request.js';
import { SessionGuard } from '../common/session.guard.js';
import { InitiateTransferDto, UploadPayloadDto } from './dto/transfer.dto.js';
import { TransferService } from './transfer.service.js';

/** Extract session user ID or throw 401. */
function requireSessionUserId(req: AuthenticatedRequest): string {
	if (!req.sessionUserId) {
		throw new UnauthorizedException('Session user ID not available');
	}
	return req.sessionUserId;
}

@Controller('auth/transfer')
@UseGuards(SessionGuard)
export class TransferController {
	constructor(@Inject(TransferService) private readonly transferService: TransferService) {}

	/**
	 * POST /auth/transfer/initiate — Create a transfer record.
	 */
	@Post('initiate')
	async initiate(@Body() body: InitiateTransferDto, @Req() req: AuthenticatedRequest) {
		const userId = requireSessionUserId(req);
		return this.transferService.initiate(body.signerId, userId, body.direction);
	}

	/**
	 * PATCH /auth/transfer/:id — Upload encrypted share payload.
	 */
	@Patch(':id')
	async uploadPayload(
		@Param('id', ParseUUIDPipe) transferId: string,
		@Body() body: UploadPayloadDto,
		@Req() req: AuthenticatedRequest,
	) {
		const userId = requireSessionUserId(req);
		await this.transferService.uploadPayload(transferId, userId, body.encryptedPayload);
		return { success: true };
	}

	/**
	 * GET /auth/transfer/pending?signerId= — Find pending transfer for a signer.
	 */
	@Get('pending')
	async findPending(
		@Query('signerId', ParseUUIDPipe) signerId: string,
		@Req() req: AuthenticatedRequest,
	) {
		const userId = requireSessionUserId(req);
		const result = await this.transferService.findPending(signerId, userId);
		return result ?? { transferId: null, direction: null, expiresAt: null };
	}

	/**
	 * POST /auth/transfer/:id/claim — Lock + return encrypted blob.
	 */
	@Post(':id/claim')
	async claim(@Param('id', ParseUUIDPipe) transferId: string, @Req() req: AuthenticatedRequest) {
		const userId = requireSessionUserId(req);
		return this.transferService.claim(transferId, userId);
	}

	/**
	 * POST /auth/transfer/:id/confirm — Confirm successful re-encryption.
	 */
	@Post(':id/confirm')
	async confirm(@Param('id', ParseUUIDPipe) transferId: string, @Req() req: AuthenticatedRequest) {
		const userId = requireSessionUserId(req);
		await this.transferService.confirm(transferId, userId);
		return { success: true };
	}
}
