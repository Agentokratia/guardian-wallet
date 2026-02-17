import { PolicyType } from '@agentokratia/guardian-core';
import {
	IsArray,
	IsBoolean,
	IsEnum,
	IsNotEmpty,
	IsObject,
	IsOptional,
	IsString,
} from 'class-validator';

export class CreatePolicyDto {
	@IsEnum(PolicyType)
	type!: PolicyType;

	@IsObject()
	@IsNotEmpty()
	config!: Record<string, unknown>;

	@IsOptional()
	@IsBoolean()
	enabled?: boolean;

	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	appliesTo?: string[];
}
