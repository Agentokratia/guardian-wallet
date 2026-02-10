import { IsInt, IsOptional, IsString, Matches } from 'class-validator';

export class TransactionDto {
	@IsString()
	@IsOptional()
	@Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'to must be a valid Ethereum address' })
	to?: string;

	@IsString()
	@IsOptional()
	value?: string;

	@IsString()
	@IsOptional()
	@Matches(/^0x[0-9a-fA-F]*$/, { message: 'data must be valid hex' })
	data?: string;

	@IsInt()
	@IsOptional()
	chainId?: number;

	/** Accepted for CLI compatibility but not used server-side (server uses chainId). */
	@IsString()
	@IsOptional()
	network?: string;

	@IsString()
	@IsOptional()
	gasLimit?: string;

	@IsString()
	@IsOptional()
	gasPrice?: string;

	@IsString()
	@IsOptional()
	maxFeePerGas?: string;

	@IsString()
	@IsOptional()
	maxPriorityFeePerGas?: string;

	@IsInt()
	@IsOptional()
	nonce?: number;
}
