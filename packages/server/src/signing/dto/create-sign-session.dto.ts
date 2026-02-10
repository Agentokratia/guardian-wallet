import { Type } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';
import { TransactionDto } from './transaction.dto.js';

export class CreateSignSessionDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(1_000_000)
	signerFirstMessage!: string; // base64-encoded

	@ValidateNested()
	@Type(() => TransactionDto)
	transaction!: TransactionDto;
}
