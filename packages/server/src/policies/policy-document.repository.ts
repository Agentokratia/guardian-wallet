import type { PolicyRule } from '@agentokratia/guardian-core';
import { Inject, Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service.js';
import type {
	PolicyDocumentEntity,
	PolicyDocumentRow,
	PolicyDocumentStatus,
} from './policy-document.types.js';

@Injectable()
export class PolicyDocumentRepository {
	private readonly tableName = 'policy_documents';

	constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

	async findBySigner(signerId: string): Promise<PolicyDocumentEntity | null> {
		// Return active policy (used by signing service)
		// Uses order+limit instead of .single() to handle edge case of
		// duplicate active records (picks latest activated)
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.select('*')
			.eq('signer_id', signerId)
			.eq('status', 'active')
			.order('activated_at', { ascending: false, nullsFirst: false })
			.limit(1);

		if (error || !data || data.length === 0) return null;
		return this.toDomain(data[0] as PolicyDocumentRow);
	}

	async upsert(
		signerId: string,
		rules: readonly PolicyRule[],
		description?: string,
	): Promise<PolicyDocumentEntity> {
		return this.upsertWithStatus(signerId, rules, 'active', description);
	}

	private async upsertWithStatus(
		signerId: string,
		rules: readonly PolicyRule[],
		status: PolicyDocumentStatus,
		description?: string,
	): Promise<PolicyDocumentEntity> {
		const rulesJson = JSON.parse(JSON.stringify(rules));

		// Atomic RPC: INSERT ... ON CONFLICT DO UPDATE in one statement.
		const { data: rpcData, error: rpcError } = await this.supabase.client.rpc(
			'upsert_policy_document',
			{
				p_signer_id: signerId,
				p_rules: rulesJson,
				p_status: status,
				p_description: description ?? null,
			},
		);

		if (!rpcError && rpcData && (Array.isArray(rpcData) ? rpcData.length > 0 : rpcData)) {
			const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
			return this.toDomain(row as PolicyDocumentRow);
		}

		// Fallback: client-side update-then-insert for environments without the RPC
		const now = new Date().toISOString();

		const { data: updated, error: updateError } = await this.supabase.client
			.from(this.tableName)
			.update({
				rules: rulesJson,
				description: description ?? null,
				activated_at: status === 'active' ? now : null,
			})
			.eq('signer_id', signerId)
			.eq('status', status)
			.select('*')
			.single();

		if (!updateError && updated) {
			return this.toDomain(updated as PolicyDocumentRow);
		}

		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.insert({
				signer_id: signerId,
				rules: rulesJson,
				description: description ?? null,
				version: 1,
				status,
				activated_at: status === 'active' ? now : null,
			})
			.select('*')
			.single();

		if (error || !data) {
			throw new Error(`Failed to upsert policy document: ${error?.message ?? 'unknown'}`);
		}
		return this.toDomain(data as PolicyDocumentRow);
	}

	private toDomain(row: PolicyDocumentRow): PolicyDocumentEntity {
		return {
			id: row.id,
			signerId: row.signer_id,
			description: row.description ?? undefined,
			rules: row.rules as PolicyRule[],
			version: row.version,
			status: (row.status ?? 'active') as PolicyDocumentStatus,
			activatedAt: row.activated_at ?? undefined,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}
