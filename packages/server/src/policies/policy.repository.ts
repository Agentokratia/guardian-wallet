import { Inject, Injectable } from '@nestjs/common';
import type { PolicyConfig, PolicyType } from '@agentokratia/guardian-core';
import { SupabaseService } from '../common/supabase.service.js';
import type { CreatePolicyDto, PolicyEntity, PolicyRow, UpdatePolicyDto } from './policy.types.js';

@Injectable()
export class PolicyRepository {
	private readonly tableName = 'policies';

	constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

	async findById(id: string): Promise<PolicyEntity | null> {
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.select('*')
			.eq('id', id)
			.single();

		if (error || !data) return null;
		return this.toDomain(data as PolicyRow);
	}

	async findBySigner(signerId: string): Promise<PolicyEntity[]> {
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.select('*')
			.eq('signer_id', signerId)
			.order('created_at', { ascending: true });

		if (error || !data) return [];
		return (data as PolicyRow[]).map((row) => this.toDomain(row));
	}

	async findEnabledBySigner(signerId: string): Promise<PolicyEntity[]> {
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.select('*')
			.eq('signer_id', signerId)
			.eq('enabled', true)
			.order('created_at', { ascending: true });

		if (error || !data) return [];
		return (data as PolicyRow[]).map((row) => this.toDomain(row));
	}

	async create(dto: CreatePolicyDto): Promise<PolicyEntity> {
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.insert({
				signer_id: dto.signerId,
				type: dto.type,
				config: dto.config,
				enabled: dto.enabled ?? true,
				applies_to: dto.appliesTo ? [...dto.appliesTo] : null,
			})
			.select('*')
			.single();

		if (error || !data) {
			throw new Error(`Failed to create policy: ${error?.message ?? 'unknown'}`);
		}
		return this.toDomain(data as PolicyRow);
	}

	async update(id: string, dto: UpdatePolicyDto): Promise<PolicyEntity> {
		const updates: Record<string, unknown> = {};
		if (dto.config !== undefined) updates.config = dto.config;
		if (dto.enabled !== undefined) updates.enabled = dto.enabled;
		if (dto.appliesTo !== undefined) updates.applies_to = dto.appliesTo ? [...dto.appliesTo] : null;

		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.update(updates)
			.eq('id', id)
			.select('*')
			.single();

		if (error || !data) {
			throw new Error(`Failed to update policy: ${error?.message ?? 'unknown'}`);
		}
		return this.toDomain(data as PolicyRow);
	}

	async delete(id: string): Promise<void> {
		const { error } = await this.supabase.client.from(this.tableName).delete().eq('id', id);

		if (error) {
			throw new Error(`Failed to delete policy: ${error.message}`);
		}
	}

	async incrementTimesTriggered(id: string): Promise<void> {
		const { error } = await this.supabase.client.rpc('increment_policy_triggered', {
			policy_id: id,
		});

		if (error) {
			// RPC missing (migration not applied yet) — fall back to read-then-write.
			// Acceptable because policy counters are advisory, not security-critical.
			const existing = await this.findById(id);
			if (existing) {
				await this.supabase.client
					.from(this.tableName)
					.update({ times_triggered: (existing.timesTriggered ?? 0) + 1 })
					.eq('id', id);
			}
		}
	}

	private toDomain(row: PolicyRow): PolicyEntity {
		return {
			id: row.id,
			signerId: row.signer_id,
			type: row.type as PolicyType,
			config: row.config as unknown as PolicyConfig,
			enabled: row.enabled,
			appliesTo: row.applies_to ?? undefined,
			timesTriggered: row.times_triggered,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}
