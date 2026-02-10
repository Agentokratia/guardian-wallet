import { Allow, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateMessageSignSessionDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(1_000_000)
	signerFirstMessage!: string; // base64-encoded

	@IsOptional()
	@Allow()
	message?: unknown; // raw message or EIP-712 typed data — stored for audit trail
}
