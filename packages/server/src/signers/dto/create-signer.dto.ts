import { ChainName, SchemeName, SignerType } from '@agentokratia/guardian-core';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateSignerDto {
	@IsString()
	@IsNotEmpty()
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
