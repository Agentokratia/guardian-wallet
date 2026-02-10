import { IsOptional, IsString } from 'class-validator';

export class UpdateSignerDto {
	@IsOptional()
	@IsString()
	name?: string;

	@IsOptional()
	@IsString()
	description?: string;
}
