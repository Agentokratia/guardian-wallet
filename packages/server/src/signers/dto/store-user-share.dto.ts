import { IsString, MaxLength, Validate } from 'class-validator';
import { IsEvmAddress } from '../../common/validators.js';

export class StoreUserShareDto {
	@IsString()
	@Validate(IsEvmAddress)
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
