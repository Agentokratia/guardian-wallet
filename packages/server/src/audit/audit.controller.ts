import { Controller, Get, Inject, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { RequestStatus } from '@agentokratia/guardian-core';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../common/authenticated-request.js';
import { EitherAuthGuard } from '../common/either-auth.guard.js';
import { SigningRequestRepository } from './signing-request.repository.js';
import type { AuditLogFilters, SigningRequestEntity } from './signing-request.types.js';

/**
 * Escapes a value for safe CSV output.
 * - Wraps in double quotes
 * - Escapes embedded double quotes by doubling them
 * - Prefixes formula-injection characters (=, +, -, @, \t, \r) with a single quote
 */
function escapeCsvField(value: string): string {
	let safe = value;
	if (/^[=+\-@\t\r]/.test(safe)) {
		safe = `'${safe}`;
	}
	return `"${safe.replace(/"/g, '""')}"`;
}

@Controller()
@UseGuards(EitherAuthGuard)
export class AuditController {
	constructor(@Inject(SigningRequestRepository) private readonly signingRequestRepo: SigningRequestRepository) {}

	@Get('audit-log')
	async list(
		@Req() req: AuthenticatedRequest,
		@Query('signerId') signerId?: string,
		@Query('status') status?: string,
		@Query('requestType') requestType?: string,
		@Query('from') from?: string,
		@Query('to') to?: string,
		@Query('page') page?: string,
		@Query('limit') limit?: string,
	) {
		const filters: AuditLogFilters = {
			signerId: req.signerId ?? signerId ?? undefined,
			status: (status as RequestStatus) || undefined,
			requestType: requestType || undefined,
			from: from ? new Date(from) : undefined,
			to: to ? new Date(to) : undefined,
			ownerAddress: req.sessionUser?.toLowerCase(),
		};

		const pagination = {
			page: Math.max(1, Number(page) || 1),
			limit: Math.min(100, Math.max(1, Number(limit) || 20)),
		};

		const result = await this.signingRequestRepo.findAll(filters, pagination);

		return {
			data: result.data.map((entry) => ({
				...entry,
				policyViolations: entry.policyViolations.map(({ type, reason }) => ({ type, reason })),
			})),
			meta: {
				total: result.total,
				page: result.page,
				limit: result.limit,
				totalPages: Math.ceil(result.total / result.limit),
			},
		};
	}

	@Get('audit-log/export')
	async exportCsv(
		@Req() req: AuthenticatedRequest,
		@Res() res: Response,
		@Query('signerId') signerId?: string,
		@Query('status') status?: string,
		@Query('from') from?: string,
		@Query('to') to?: string,
	) {
		const filters: AuditLogFilters = {
			signerId: req.signerId ?? signerId ?? undefined,
			status: (status as RequestStatus) || undefined,
			from: from ? new Date(from) : undefined,
			to: to ? new Date(to) : undefined,
			ownerAddress: req.sessionUser?.toLowerCase(),
		};

		// Fetch all matching records (up to 10k for export)
		const result = await this.signingRequestRepo.findAll(filters, { page: 1, limit: 10_000 });

		const header =
			'id,signer_id,request_type,signing_path,status,to_address,value_wei,chain_id,tx_hash,decoded_action,policies_evaluated,evaluation_time_ms,created_at';
		const rows = result.data.map((r: SigningRequestEntity) =>
			[
				r.id,
				r.signerId,
				r.requestType,
				r.signingPath,
				r.status,
				r.toAddress ?? '',
				r.valueWei ?? '',
				r.chainId ?? '',
				r.txHash ?? '',
				r.decodedAction ?? '',
				r.policiesEvaluated,
				r.evaluationTimeMs ?? '',
				r.createdAt.toISOString(),
			]
				.map((v) => escapeCsvField(String(v)))
				.join(','),
		);

		const csv = [header, ...rows].join('\n');

		res.setHeader('Content-Type', 'text/csv');
		res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
		res.send(csv);
	}
}
