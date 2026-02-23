import {
	BadRequestException,
	Body,
	ConflictException,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Inject,
	Param,
	Post,
	Query,
	UseGuards,
} from '@nestjs/common';
import { EitherAuthGuard } from '../common/either-auth.guard.js';
import { SessionGuard } from '../common/session.guard.js';
import { CreateContractDto } from './dto/create-contract.dto.js';
import { KnownContractRepository } from './known-contract.repository.js';

@Controller('contracts')
export class KnownContractController {
	constructor(@Inject(KnownContractRepository) private readonly repo: KnownContractRepository) {}

	@Get()
	@UseGuards(EitherAuthGuard)
	async list(@Query('chainId') chainId?: string) {
		if (chainId) {
			const parsed = Number.parseInt(chainId, 10);
			if (Number.isNaN(parsed)) {
				return [];
			}
			return this.repo.findByChain(parsed);
		}
		return this.repo.findAll();
	}

	@Post()
	@UseGuards(SessionGuard)
	@HttpCode(HttpStatus.CREATED)
	async create(@Body() body: CreateContractDto) {
		try {
			return await this.repo.create({
				protocol: body.protocol,
				name: body.name,
				address: body.address,
				chainId: body.chainId,
				contractType: body.contractType,
				source: body.source,
				tags: body.tags,
				addedBy: 'dashboard',
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to create contract';
			if (message.includes('already exists')) {
				throw new ConflictException(message);
			}
			throw err;
		}
	}

	@Delete(':id')
	@UseGuards(SessionGuard)
	@HttpCode(HttpStatus.NO_CONTENT)
	async remove(@Param('id') id: string) {
		if (!/^[0-9a-f-]{36}$/i.test(id)) {
			throw new BadRequestException('Invalid contract ID format');
		}
		await this.repo.delete(id);
	}
}
