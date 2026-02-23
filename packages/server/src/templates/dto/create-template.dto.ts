import {
	IsArray,
	IsBoolean,
	IsInt,
	IsObject,
	IsOptional,
	IsString,
	Matches,
} from 'class-validator';

export class CreatePolicyTemplateDto {
	@IsString()
	name!: string;

	@IsString()
	@Matches(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, {
		message: 'slug must be lowercase alphanumeric with hyphens',
	})
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
