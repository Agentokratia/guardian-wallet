import {
	Body,
	Controller,
	Delete,
	Get,
	Inject,
	NotFoundException,
	Param,
	Post,
	Put,
	Query,
	UseGuards,
} from '@nestjs/common';
import { EitherAuthGuard } from '../common/either-auth.guard.js';
import { SessionGuard } from '../common/session.guard.js';
import type { CreatePolicyTemplateDto } from './dto/create-template.dto.js';
import type { UpdatePolicyTemplateDto } from './dto/update-template.dto.js';
import { PolicyTemplateRepository } from './policy-template.repository.js';

@Controller('policy-templates')
export class PolicyTemplateController {
	constructor(@Inject(PolicyTemplateRepository) private readonly repo: PolicyTemplateRepository) {}

	/** List visible templates (public — used by guardrails page template picker). */
	@Get()
	@UseGuards(EitherAuthGuard)
	async list(@Query('chainId') chainId?: string) {
		if (chainId) {
			const parsed = Number.parseInt(chainId, 10);
			if (Number.isNaN(parsed)) {
				return [];
			}
			return this.repo.findByChainId(parsed);
		}
		return this.repo.findAll();
	}

	/** List ALL templates including hidden (admin — used by templates management page). */
	@Get('admin')
	@UseGuards(SessionGuard)
	async listAll() {
		return this.repo.findAllAdmin();
	}

	/** Create a new template. */
	@Post()
	@UseGuards(SessionGuard)
	async create(@Body() dto: CreatePolicyTemplateDto) {
		return this.repo.create({
			name: dto.name,
			slug: dto.slug,
			description: dto.description,
			icon: dto.icon,
			rules: dto.rules,
			chainIds: dto.chainIds,
			sortOrder: dto.sortOrder,
			visible: dto.visible,
		});
	}

	/** Update an existing template. */
	@Put(':id')
	@UseGuards(SessionGuard)
	async update(@Param('id') id: string, @Body() dto: UpdatePolicyTemplateDto) {
		const existing = await this.repo.findById(id);
		if (!existing) {
			throw new NotFoundException('Template not found');
		}
		return this.repo.update(id, {
			name: dto.name,
			slug: dto.slug,
			description: dto.description,
			icon: dto.icon,
			rules: dto.rules,
			chainIds: dto.chainIds,
			sortOrder: dto.sortOrder,
			visible: dto.visible,
		});
	}

	/** Delete a template. */
	@Delete(':id')
	@UseGuards(SessionGuard)
	async remove(@Param('id') id: string) {
		const existing = await this.repo.findById(id);
		if (!existing) {
			throw new NotFoundException('Template not found');
		}
		await this.repo.delete(id);
		return { deleted: true };
	}
}
