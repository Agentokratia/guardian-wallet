import {
	IsEthereumAddress,
	IsInt,
	IsNotEmpty,
	IsOptional,
	IsString,
	Max,
	Min,
} from 'class-validator';

export class AddTokenDto {
	@IsInt()
	chainId!: number;

	@IsEthereumAddress()
	address!: string;

	@IsString()
	@IsNotEmpty()
	symbol!: string;

	@IsString()
	@IsNotEmpty()
	name!: string;

	@IsInt()
	@Min(0)
	@Max(18)
	@IsOptional()
	decimals?: number;
}
