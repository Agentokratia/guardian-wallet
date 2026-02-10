import { IsString, Matches, MaxLength } from 'class-validator';

export class StoreUserShareDto {
	@IsString()
	@Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'walletAddress must be a valid Ethereum address' })
	walletAddress!: string;

	@IsString()
	@MaxLength(100)
	iv!: string;

	@IsString()
	@MaxLength(1_000_000)
	ciphertext!: string;

	@IsString()
	@MaxLength(100)
	salt!: string;
}
