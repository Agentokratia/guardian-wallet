import { IsArray, IsOptional, IsString } from 'class-validator';

export class SavePolicyDocumentDto {
	@IsArray()
	rules!: Record<string, unknown>[];

	@IsOptional()
	@IsString()
	description?: string;
}
