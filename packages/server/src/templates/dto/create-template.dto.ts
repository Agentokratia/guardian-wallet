import { IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString } from 'class-validator';

export class CreatePolicyTemplateDto {
	@IsString()
	name!: string;

	@IsString()
	slug!: string;

	@IsOptional()
	@IsString()
	description?: string;

	@IsOptional()
	@IsString()
	icon?: string;

	@IsArray()
	@IsObject({ each: true })
	rules!: Record<string, unknown>[];

	@IsOptional()
	@IsArray()
	@IsInt({ each: true })
	chainIds?: number[];

	@IsOptional()
	@IsInt()
	sortOrder?: number;

	@IsOptional()
	@IsBoolean()
	visible?: boolean;
}
