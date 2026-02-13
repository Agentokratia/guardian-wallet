import { Allow, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateMessageSignSessionDto {
	@IsOptional()
	@IsString()
	@MaxLength(1_000_000)
	signerFirstMessage?: string; // base64-encoded — optional (server generates EID first)

	@IsString()
	@IsNotEmpty()
	@MaxLength(1_000_000)
	messageHash!: string; // base64-encoded — CGGMP24 requires hash upfront

	@IsOptional()
	@Allow()
	message?: unknown; // raw message or EIP-712 typed data — stored for audit trail
}
