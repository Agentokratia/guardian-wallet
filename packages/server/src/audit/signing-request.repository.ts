import type { PolicyViolation } from '@agentokratia/guardian-core';
import { Inject, Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service.js';
import type {
	AuditLogFilters,
	CreateSigningRequestDto,
	PaginatedResult,
	PaginationParams,
	SigningRequestEntity,
	SigningRequestRow,
} from './signing-request.types.js';

@Injectable()
export class SigningRequestRepository {
	private readonly tableName = 'signing_requests';

	constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

	async create(dto: CreateSigningRequestDto): Promise<SigningRequestEntity> {
		const row = {
			signer_id: dto.signerId,
			request_type: dto.requestType,
			signing_path: dto.signingPath,
			status: dto.status,
			to_address: dto.toAddress ?? null,
			value_wei: dto.valueWei ?? null,
			chain_id: dto.chainId ?? null,
			tx_data: dto.txData ?? null,
			decoded_action: dto.decodedAction ?? null,
			tx_hash: dto.txHash ?? null,
			nonce: dto.nonce ?? null,
			policy_violations: dto.policyViolations ?? [],
			policies_evaluated: dto.policiesEvaluated ?? 0,
			evaluation_time_ms: dto.evaluationTimeMs ?? null,
			owner_address: dto.ownerAddress ?? '0x0000000000000000000000000000000000000000',
		};

		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.insert(row)
			.select()
			.single();

		if (error || !data) {
			throw new Error(`Failed to create signing request: ${error?.message}`);
		}

		return this.toDomain(data as SigningRequestRow);
	}

	async findAll(
		filters: AuditLogFilters,
		pagination: PaginationParams,
	): Promise<PaginatedResult<SigningRequestEntity>> {
		const { page, limit } = pagination;
		const offset = (page - 1) * limit;

		let query = this.supabase.client.from(this.tableName).select('*', { count: 'exact' });

		if (filters.signerId) {
			query = query.eq('signer_id', filters.signerId);
		}
		if (filters.status) {
			query = query.eq('status', filters.status);
		}
		if (filters.requestType) {
			query = query.eq('request_type', filters.requestType);
		}
		if (filters.ownerAddress) {
			query = query.eq('owner_address', filters.ownerAddress);
		}
		if (filters.from) {
			query = query.gte('created_at', filters.from.toISOString());
		}
		if (filters.to) {
			query = query.lte('created_at', filters.to.toISOString());
		}

		query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

		const { data, error, count } = await query;

		if (error) {
			throw new Error(`Failed to query signing requests: ${error.message}`);
		}

		return {
			data: (data as SigningRequestRow[]).map((row) => this.toDomain(row)),
			total: count ?? 0,
			page,
			limit,
		};
	}

	async countBySignerInWindow(signerId: string, windowStart: Date): Promise<number> {
		const { count, error } = await this.supabase.client
			.from(this.tableName)
			.select('id', { count: 'exact', head: true })
			.eq('signer_id', signerId)
			.eq('status', 'approved')
			.gte('created_at', windowStart.toISOString());

		if (error) {
			throw new Error(`Failed to count signing requests: ${error.message}`);
		}

		return count ?? 0;
	}

	async sumValueBySignerInWindow(signerId: string, windowStart: Date): Promise<bigint> {
		// Prefer server-side SUM via RPC (migration 00012)
		const { data: rpcResult, error: rpcError } = await this.supabase.client.rpc(
			'sum_value_by_signer_in_window',
			{
				p_signer_id: signerId,
				p_window_start: windowStart.toISOString(),
			},
		);

		if (!rpcError && rpcResult != null) {
			return BigInt(rpcResult as string);
		}

		// Fallback: client-side aggregation (RPC not yet deployed)
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.select('value_wei')
			.eq('signer_id', signerId)
			.in('status', ['approved', 'broadcast'])
			.gte('created_at', windowStart.toISOString());

		if (error) {
			throw new Error(`Failed to sum values: ${error.message}`);
		}

		let total = 0n;
		for (const row of data ?? []) {
			const val = (row as { value_wei: string | null }).value_wei;
			if (val != null) {
				total += BigInt(val);
			}
		}
		return total;
	}

	private toDomain(row: SigningRequestRow): SigningRequestEntity {
		return {
			id: row.id,
			signerId: row.signer_id,
			requestType: row.request_type as SigningRequestEntity['requestType'],
			signingPath: row.signing_path as SigningRequestEntity['signingPath'],
			status: row.status as SigningRequestEntity['status'],
			toAddress: row.to_address,
			valueWei: row.value_wei,
			chainId: row.chain_id,
			txData: row.tx_data,
			decodedAction: row.decoded_action,
			txHash: row.tx_hash,
			nonce: row.nonce,
			policyViolations: (row.policy_violations ?? []) as unknown as readonly PolicyViolation[],
			policiesEvaluated: row.policies_evaluated,
			evaluationTimeMs: row.evaluation_time_ms,
			createdAt: new Date(row.created_at),
		};
	}
}
