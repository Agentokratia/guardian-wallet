import type { PolicyType } from '@agentokratia/guardian-core';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PolicyRepository } from './policy.repository.js';
import type { PolicyEntity } from './policy.types.js';

export interface CreatePolicyInput {
	readonly signerId: string;
	readonly type: PolicyType;
	readonly config: Record<string, unknown>;
	readonly enabled?: boolean;
	readonly appliesTo?: readonly string[];
}

export interface UpdatePolicyInput {
	readonly id: string;
	readonly config?: Record<string, unknown>;
	readonly enabled?: boolean;
	readonly appliesTo?: readonly string[];
}

@Injectable()
export class PolicyService {
	constructor(@Inject(PolicyRepository) private readonly policyRepo: PolicyRepository) {}

	async get(id: string): Promise<PolicyEntity> {
		const policy = await this.policyRepo.findById(id);
		if (!policy) {
			throw new NotFoundException(`Policy not found: ${id}`);
		}
		return policy;
	}

	async list(signerId: string): Promise<PolicyEntity[]> {
		return this.policyRepo.findBySigner(signerId);
	}

	async create(input: CreatePolicyInput): Promise<PolicyEntity> {
		return this.policyRepo.create({
			signerId: input.signerId,
			type: input.type,
			config: input.config,
			enabled: input.enabled,
			appliesTo: input.appliesTo,
		});
	}

	async update(input: UpdatePolicyInput): Promise<PolicyEntity> {
		const existing = await this.policyRepo.findById(input.id);
		if (!existing) {
			throw new NotFoundException(`Policy not found: ${input.id}`);
		}

		return this.policyRepo.update(input.id, {
			config: input.config,
			enabled: input.enabled,
			appliesTo: input.appliesTo,
		});
	}

	async delete(id: string): Promise<void> {
		const existing = await this.policyRepo.findById(id);
		if (!existing) {
			throw new NotFoundException(`Policy not found: ${id}`);
		}

		await this.policyRepo.delete(id);
	}
}
