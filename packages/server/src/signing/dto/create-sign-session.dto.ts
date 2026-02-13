import { Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { TransactionDto } from './transaction.dto.js';

export class CreateSignSessionDto {
	@IsOptional()
	@IsString()
	@MaxLength(1_000_000)
	signerFirstMessage?: string; // base64-encoded — optional for tx signing (client doesn't know hash yet)

	@ValidateNested()
	@Type(() => TransactionDto)
	transaction!: TransactionDto;
}
