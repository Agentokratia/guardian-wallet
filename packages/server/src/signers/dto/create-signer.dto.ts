import { ChainName, SchemeName, SignerType } from '@agentokratia/guardian-core';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSignerDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(64)
	name!: string;

	@IsOptional()
	@IsString()
	description?: string;

	@IsEnum(SignerType)
	type!: SignerType;

	@IsOptional()
	@IsEnum(ChainName)
	chain?: ChainName;

	@IsOptional()
	@IsEnum(SchemeName)
	scheme?: SchemeName;

	@IsOptional()
	@IsString()
	network?: string;
}
