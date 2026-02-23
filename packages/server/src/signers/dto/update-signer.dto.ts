import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSignerDto {
	@IsOptional()
	@IsString()
	@MaxLength(64)
	name?: string;

	@IsOptional()
	@IsString()
	description?: string;
}
