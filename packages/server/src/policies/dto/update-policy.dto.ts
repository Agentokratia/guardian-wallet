import { IsArray, IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';

export class UpdatePolicyDto {
	@IsOptional()
	@IsObject()
	config?: Record<string, unknown>;

	@IsOptional()
	@IsBoolean()
	enabled?: boolean;

	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	appliesTo?: string[];
}
