import type { PolicyRule } from '@agentokratia/guardian-core';
import { Inject, Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service.js';
import type { PolicyDocumentEntity, PolicyDocumentRow } from './policy-document.types.js';

@Injectable()
export class PolicyDocumentRepository {
	private readonly tableName = 'policy_documents';

	constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

	async findBySigner(signerId: string): Promise<PolicyDocumentEntity | null> {
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.select('*')
			.eq('signer_id', signerId)
			.single();

		if (error || !data) return null;
		return this.toDomain(data as PolicyDocumentRow);
	}

	async upsert(
		signerId: string,
		rules: readonly PolicyRule[],
		description?: string,
	): Promise<PolicyDocumentEntity> {
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.upsert(
				{
					signer_id: signerId,
					rules: JSON.parse(JSON.stringify(rules)),
					description: description ?? null,
					version: 2,
				},
				{ onConflict: 'signer_id' },
			)
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
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}
