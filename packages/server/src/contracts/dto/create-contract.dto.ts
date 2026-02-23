import {
	IsArray,
	IsInt,
	IsOptional,
	IsString,
	MaxLength,
	Min,
	MinLength,
	Validate,
} from 'class-validator';
import { IsEvmAddress } from '../../common/validators.js';

export class CreateContractDto {
	@IsString()
	@MinLength(1)
	@MaxLength(100)
	protocol!: string;

	@IsString()
	@MinLength(1)
	@MaxLength(200)
	name!: string;

	@IsString()
	@Validate(IsEvmAddress)
	address!: string;

	@IsInt()
	@Min(1)
	chainId!: number;

	@IsOptional()
	@IsString()
	@MaxLength(50)
	contractType?: string;

	@IsOptional()
	@IsString()
	@MaxLength(200)
	source?: string;

	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	tags?: string[];
}
