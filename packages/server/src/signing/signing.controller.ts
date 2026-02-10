import {
	BadRequestException,
	Body,
	Controller,
	ForbiddenException,
	Inject,
	Param,
	Post,
	Req,
	UseGuards,
} from '@nestjs/common';
import type { TransactionRequest } from '@agentokratia/guardian-core';
import { SigningPath } from '@agentokratia/guardian-core';
import { ApiKeyGuard } from '../common/api-key.guard.js';
import type { AuthenticatedRequest } from '../common/authenticated-request.js';
import { base64ToBytes, bytesToBase64, hexToBytes } from '../common/encoding.js';
import { SessionGuard } from '../common/session.guard.js';
import { NetworkService } from '../networks/network.service.js';
import { CompleteSignDto } from './dto/complete-sign.dto.js';
import { CreateMessageSignSessionDto } from './dto/create-message-sign-session.dto.js';
import { CreateSignSessionDto } from './dto/create-sign-session.dto.js';
import { ProcessSignRoundDto } from './dto/process-sign-round.dto.js';
import { InteractiveSignService } from './interactive-sign.service.js';

@Controller()
export class SigningController {
	constructor(
		@Inject(InteractiveSignService) private readonly interactiveSign: InteractiveSignService,
		@Inject(NetworkService) private readonly networkService: NetworkService,
	) {}

	/**
	 * Override sign — interactive DKLs23 session creation (User+Server path).
	 * Called from the dashboard with session auth (wallet login).
	 */
	@Post('signers/:id/sign/session')
	@UseGuards(SessionGuard)
	async createOverrideSignSession(
		@Req() req: AuthenticatedRequest,
		@Param('id') signerId: string,
		@Body() body: CreateSignSessionDto,
	) {
		requireSessionUser(req);
		const result = await this.interactiveSign.createSession({
			signerId,
			signerFirstMessage: base64ToBytes(body.signerFirstMessage),
			transaction: await this.toTransactionRequest(body.transaction),
			signingPath: SigningPath.USER_SERVER,
			callerIp: req.ip,
		});
		return {
			sessionId: result.sessionId,
			serverFirstMessage: bytesToBase64(result.serverFirstMessage),
			initialMessages: result.initialRoundMessages.map(bytesToBase64),
			roundsRemaining: result.roundsRemaining,
		};
	}

	/**
	 * Override sign — interactive DKLs23 round exchange (User+Server path).
	 */
	@Post('signers/:id/sign/round')
	@UseGuards(SessionGuard)
	async processOverrideSignRound(
		@Req() req: AuthenticatedRequest,
		@Param('id') signerId: string,
		@Body() body: ProcessSignRoundDto,
	) {
		requireSessionUser(req);
		const result = await this.interactiveSign.processRound({
			sessionId: body.sessionId,
			signerId,
			incomingMessages: body.messages.map(base64ToBytes),
		});
		return {
			messages: result.outgoingMessages.map(bytesToBase64),
			roundsRemaining: result.roundsRemaining,
			presigned: result.presigned,
			messageHash: result.messageHash ? bytesToBase64(result.messageHash) : undefined,
		};
	}

	/**
	 * Override sign — interactive DKLs23 finalization (User+Server path).
	 * Server combines signature and broadcasts the transaction.
	 */
	@Post('signers/:id/sign/complete')
	@UseGuards(SessionGuard)
	async completeOverrideSign(
		@Req() req: AuthenticatedRequest,
		@Param('id') signerId: string,
		@Body() body: CompleteSignDto,
	) {
		requireSessionUser(req);
		return this.interactiveSign.completeSign({
			sessionId: body.sessionId,
			signerId,
			lastMessage: base64ToBytes(body.lastMessage),
			messageHash: base64ToBytes(body.messageHash),
		});
	}

	@Post('sign/session')
	@UseGuards(ApiKeyGuard)
	async createSignSession(@Req() req: AuthenticatedRequest, @Body() body: CreateSignSessionDto) {
		const signerId = requireSignerId(req);
		const result = await this.interactiveSign.createSession({
			signerId,
			signerFirstMessage: base64ToBytes(body.signerFirstMessage),
			transaction: await this.toTransactionRequest(body.transaction),
			callerIp: req.ip,
		});
		return {
			sessionId: result.sessionId,
			serverFirstMessage: bytesToBase64(result.serverFirstMessage),
			initialMessages: result.initialRoundMessages.map(bytesToBase64),
			roundsRemaining: result.roundsRemaining,
		};
	}

	@Post('sign/round')
	@UseGuards(ApiKeyGuard)
	async processSignRound(@Req() req: AuthenticatedRequest, @Body() body: ProcessSignRoundDto) {
		const signerId = requireSignerId(req);
		const result = await this.interactiveSign.processRound({
			sessionId: body.sessionId,
			signerId,
			incomingMessages: body.messages.map(base64ToBytes),
		});
		return {
			messages: result.outgoingMessages.map(bytesToBase64),
			roundsRemaining: result.roundsRemaining,
			presigned: result.presigned,
			messageHash: result.messageHash ? bytesToBase64(result.messageHash) : undefined,
		};
	}

	@Post('sign/complete')
	@UseGuards(ApiKeyGuard)
	async completeSign(@Req() req: AuthenticatedRequest, @Body() body: CompleteSignDto) {
		const signerId = requireSignerId(req);
		return this.interactiveSign.completeSign({
			sessionId: body.sessionId,
			signerId,
			lastMessage: base64ToBytes(body.lastMessage),
			messageHash: base64ToBytes(body.messageHash),
		});
	}

	@Post('sign-message/session')
	@UseGuards(ApiKeyGuard)
	async createMessageSignSession(
		@Req() req: AuthenticatedRequest,
		@Body() body: CreateMessageSignSessionDto,
	) {
		const signerId = requireSignerId(req);
		const result = await this.interactiveSign.createMessageSession({
			signerId,
			signerFirstMessage: base64ToBytes(body.signerFirstMessage),
			callerIp: req.ip,
		});
		return {
			sessionId: result.sessionId,
			serverFirstMessage: bytesToBase64(result.serverFirstMessage),
			initialMessages: result.initialRoundMessages.map(bytesToBase64),
			roundsRemaining: result.roundsRemaining,
		};
	}

	@Post('sign-message/complete')
	@UseGuards(ApiKeyGuard)
	async completeMessageSign(@Req() req: AuthenticatedRequest, @Body() body: CompleteSignDto) {
		const signerId = requireSignerId(req);
		return this.interactiveSign.completeMessageSign({
			sessionId: body.sessionId,
			signerId,
			lastMessage: base64ToBytes(body.lastMessage),
			messageHash: base64ToBytes(body.messageHash),
		});
	}

	private async resolveChainId(tx: CreateSignSessionDto['transaction']): Promise<number> {
		if (tx.chainId && tx.chainId > 0) return tx.chainId;
		if (tx.network) {
			const net = await this.networkService.getByName(tx.network);
			return net.chainId;
		}
		throw new BadRequestException('Either chainId or network is required in transaction');
	}

	private async toTransactionRequest(tx: CreateSignSessionDto['transaction']): Promise<TransactionRequest> {
		const chainId = await this.resolveChainId(tx);
		return {
			to: tx.to,
			value: tx.value ? BigInt(tx.value) : undefined,
			data: tx.data ? hexToBytes(tx.data) : undefined,
			chainId,
			gasLimit: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
			gasPrice: tx.gasPrice ? BigInt(tx.gasPrice) : undefined,
			maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : undefined,
			maxPriorityFeePerGas: tx.maxPriorityFeePerGas
				? BigInt(tx.maxPriorityFeePerGas)
				: undefined,
			nonce: tx.nonce,
		};
	}
}

function requireSignerId(req: AuthenticatedRequest): string {
	if (!req.signerId) throw new ForbiddenException('Missing signer identity');
	return req.signerId;
}

function requireSessionUser(req: AuthenticatedRequest): string {
	if (!req.sessionUser) throw new ForbiddenException('Missing session user');
	return req.sessionUser;
}
