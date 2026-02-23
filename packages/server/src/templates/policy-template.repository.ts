import type { PolicyRule } from '@agentokratia/guardian-core';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service.js';

export interface PolicyTemplateRow {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	icon: string | null;
	rules: unknown;
	sort_order: number;
	chain_ids: number[];
	visible: boolean;
	created_at: string;
	updated_at: string;
}

export interface PolicyTemplate {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	icon: string | null;
	rules: PolicyRule[];
	sortOrder: number;
	chainIds: number[];
	visible: boolean;
	createdAt: string;
	updatedAt: string;
}

@Injectable()
export class PolicyTemplateRepository {
	private readonly tableName = 'policy_templates';

	constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

	async findAll(): Promise<PolicyTemplate[]> {
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.select('*')
			.eq('visible', true)
			.order('sort_order', { ascending: true });

		if (error || !data) return [];
		return (data as PolicyTemplateRow[]).map((row) => this.toDomain(row));
	}

	async findByChainId(chainId: number): Promise<PolicyTemplate[]> {
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.select('*')
			.eq('visible', true)
			.contains('chain_ids', [chainId])
			.order('sort_order', { ascending: true });

		if (error || !data) return [];
		return (data as PolicyTemplateRow[]).map((row) => this.toDomain(row));
	}

	async findBySlug(slug: string): Promise<PolicyTemplate | null> {
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.select('*')
			.eq('slug', slug)
			.single();

		if (error || !data) return null;
		return this.toDomain(data as PolicyTemplateRow);
	}

	async findAllAdmin(): Promise<PolicyTemplate[]> {
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.select('*')
			.order('sort_order', { ascending: true });

		if (error || !data) return [];
		return (data as PolicyTemplateRow[]).map((row) => this.toDomain(row));
	}

	async findById(id: string): Promise<PolicyTemplate | null> {
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.select('*')
			.eq('id', id)
			.single();

		if (error || !data) return null;
		return this.toDomain(data as PolicyTemplateRow);
	}

	async create(input: {
		name: string;
		slug: string;
		description?: string;
		icon?: string;
		rules: unknown[];
		chainIds?: number[];
		sortOrder?: number;
		visible?: boolean;
	}): Promise<PolicyTemplate> {
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.insert({
				name: input.name,
				slug: input.slug,
				description: input.description ?? null,
				icon: input.icon ?? null,
				rules: input.rules,
				chain_ids: input.chainIds ?? [],
				sort_order: input.sortOrder ?? 100,
				visible: input.visible ?? true,
			})
			.select('*')
			.single();

		if (error || !data) {
			if (error?.code === '23505') {
				throw new ConflictException('A template with this slug already exists');
			}
			throw new Error(error?.message ?? 'Failed to create template');
		}
		return this.toDomain(data as PolicyTemplateRow);
	}

	async update(
		id: string,
		input: {
			name?: string;
			slug?: string;
			description?: string;
			icon?: string;
			rules?: unknown[];
			chainIds?: number[];
			sortOrder?: number;
			visible?: boolean;
		},
	): Promise<PolicyTemplate> {
		const row: Record<string, unknown> = {};
		if (input.name !== undefined) row.name = input.name;
		if (input.slug !== undefined) row.slug = input.slug;
		if (input.description !== undefined) row.description = input.description;
		if (input.icon !== undefined) row.icon = input.icon;
		if (input.rules !== undefined) row.rules = input.rules;
		if (input.chainIds !== undefined) row.chain_ids = input.chainIds;
		if (input.sortOrder !== undefined) row.sort_order = input.sortOrder;
		if (input.visible !== undefined) row.visible = input.visible;

		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.update(row)
			.eq('id', id)
			.select('*')
			.single();

		if (error || !data) {
			if (error?.code === '23505') {
				throw new ConflictException('A template with this slug already exists');
			}
			throw new Error(error?.message ?? 'Failed to update template');
		}
		return this.toDomain(data as PolicyTemplateRow);
	}

	async delete(id: string): Promise<void> {
		const { error } = await this.supabase.client.from(this.tableName).delete().eq('id', id);

		if (error) {
			throw new Error(error.message);
		}
	}

	private toDomain(row: PolicyTemplateRow): PolicyTemplate {
		return {
			id: row.id,
			slug: row.slug,
			name: row.name,
			description: row.description,
			icon: row.icon,
			rules: row.rules as PolicyRule[],
			sortOrder: row.sort_order,
			chainIds: row.chain_ids ?? [],
			visible: row.visible,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}
