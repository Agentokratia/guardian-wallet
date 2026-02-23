import type { PolicyRule } from '@agentokratia/guardian-core';
import {
	Body,
	Controller,
	Delete,
	ForbiddenException,
	Get,
	HttpCode,
	HttpStatus,
	Inject,
	Param,
	Patch,
	Post,
	Put,
	Req,
	UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/authenticated-request.js';
import { EitherAdminGuard } from '../common/either-admin.guard.js';
import { SignerService } from '../signers/signer.service.js';
import type { CreatePolicyDto } from './dto/create-policy.dto.js';
import type { SavePolicyDocumentDto } from './dto/save-policy-document.dto.js';
import type { UpdatePolicyDto } from './dto/update-policy.dto.js';
import { PolicyBacktestService } from './policy-backtest.service.js';
import { PolicyDocumentService } from './policy-document.service.js';
import { PolicyService } from './policy.service.js';

@Controller()
@UseGuards(EitherAdminGuard)
export class PolicyController {
	constructor(
		@Inject(PolicyService) private readonly policyService: PolicyService,
		@Inject(PolicyDocumentService) private readonly policyDocService: PolicyDocumentService,
		@Inject(SignerService) private readonly signerService: SignerService,
		@Inject(PolicyBacktestService) private readonly backtestService: PolicyBacktestService,
	) {}

	private async verifySignerOwnership(signerId: string, req: AuthenticatedRequest) {
		if (!req.signerId && !req.sessionUser) {
			throw new ForbiddenException('No authenticated identity');
		}
		if (req.signerId && req.signerId !== signerId) {
			throw new ForbiddenException('API key does not match this signer');
		}
		const signer = await this.signerService.get(signerId);
		if (req.sessionUser && signer.ownerAddress.toLowerCase() !== req.sessionUser.toLowerCase()) {
			throw new ForbiddenException('You do not own this signer');
		}
		return signer;
	}

	// ─── Policy Document (new) ─────────────────────────────────────

	@Get('signers/:id/policy')
	async getDocument(@Param('id') signerId: string, @Req() req: AuthenticatedRequest) {
		await this.verifySignerOwnership(signerId, req);
		const doc = await this.policyDocService.get(signerId);
		return doc ?? { rules: [], description: null };
	}

	@Put('signers/:id/policy')
	async saveDocument(
		@Param('id') signerId: string,
		@Body() body: SavePolicyDocumentDto,
		@Req() req: AuthenticatedRequest,
	) {
		await this.verifySignerOwnership(signerId, req);
		return this.policyDocService.save(
			signerId,
			body.rules as unknown as PolicyRule[],
			body.description,
		);
	}

	// ─── Draft / Activate / Backtest ──────────────────────────────────────────

	@Get('signers/:id/policy/draft')
	async getDraft(@Param('id') signerId: string, @Req() req: AuthenticatedRequest) {
		await this.verifySignerOwnership(signerId, req);
		const doc = await this.policyDocService.getDraft(signerId);
		return doc ?? { rules: [], description: null, status: 'draft' };
	}

	@Put('signers/:id/policy/draft')
	async saveDraft(
		@Param('id') signerId: string,
		@Body() body: SavePolicyDocumentDto,
		@Req() req: AuthenticatedRequest,
	) {
		await this.verifySignerOwnership(signerId, req);
		return this.policyDocService.saveDraft(
			signerId,
			body.rules as unknown as PolicyRule[],
			body.description,
		);
	}

	@Post('signers/:id/policy/activate')
	@HttpCode(HttpStatus.OK)
	async activate(@Param('id') signerId: string, @Req() req: AuthenticatedRequest) {
		await this.verifySignerOwnership(signerId, req);
		return this.policyDocService.activate(signerId);
	}

	@Post('signers/:id/policy/backtest')
	@HttpCode(HttpStatus.OK)
	async backtest(
		@Param('id') signerId: string,
		@Body() body: { rules?: PolicyRule[] },
		@Req() req: AuthenticatedRequest,
	) {
		await this.verifySignerOwnership(signerId, req);

		// Prefer rules from the request body (live editor state),
		// fall back to saved draft, then to empty result.
		let rules: readonly PolicyRule[] | undefined = body.rules;
		if (rules && rules.length > 0) {
			this.policyDocService.validateRules(rules);
		}
		if (!rules || rules.length === 0) {
			const draft = await this.policyDocService.getDraft(signerId);
			rules = draft?.rules;
		}
		if (!rules || rules.length === 0) {
			return { totalAnalyzed: 0, wouldPass: 0, wouldBlock: 0, blockedRequests: [] };
		}
		return this.backtestService.backtest(signerId, rules);
	}

	// ─── Legacy CRUD (kept for backward compatibility) ───────────────────────

	@Get('signers/:id/policies')
	async list(@Param('id') signerId: string, @Req() req: AuthenticatedRequest) {
		await this.verifySignerOwnership(signerId, req);
		return this.policyService.list(signerId);
	}

	@Post('signers/:id/policies')
	@HttpCode(HttpStatus.CREATED)
	async create(
		@Param('id') signerId: string,
		@Body() body: CreatePolicyDto,
		@Req() req: AuthenticatedRequest,
	) {
		await this.verifySignerOwnership(signerId, req);
		return this.policyService.create({
			signerId,
			type: body.type,
			config: body.config,
			enabled: body.enabled,
			appliesTo: body.appliesTo,
		});
	}

	@Patch('policies/:id')
	async update(
		@Param('id') policyId: string,
		@Body() body: UpdatePolicyDto,
		@Req() req: AuthenticatedRequest,
	) {
		const policy = await this.policyService.get(policyId);
		await this.verifySignerOwnership(policy.signerId, req);
		return this.policyService.update({
			id: policyId,
			config: body.config,
			enabled: body.enabled,
			appliesTo: body.appliesTo,
		});
	}

	@Delete('policies/:id')
	@HttpCode(HttpStatus.NO_CONTENT)
	async remove(@Param('id') policyId: string, @Req() req: AuthenticatedRequest) {
		const policy = await this.policyService.get(policyId);
		await this.verifySignerOwnership(policy.signerId, req);
		await this.policyService.delete(policyId);
	}
}
