import { SchemeName, SignerType } from '@agentokratia/guardian-core';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePublicSignerDto {
	@IsString()
	@IsNotEmpty()
	@MinLength(1)
	@MaxLength(64)
	name!: string;

	@IsOptional()
	@IsEnum(SignerType)
	type?: SignerType;

	@IsOptional()
	@IsEnum(SchemeName)
	scheme?: SchemeName;

	@IsOptional()
	@IsString()
	network?: string;
}
