import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';

export class SavePolicyDocumentDto {
	@IsArray()
	@IsObject({ each: true })
	rules!: Record<string, unknown>[];

	@IsOptional()
	@IsString()
	description?: string;
}
