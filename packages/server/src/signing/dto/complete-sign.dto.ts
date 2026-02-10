import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CompleteSignDto {
	@IsString()
	@IsNotEmpty()
	sessionId!: string;

	@IsString()
	@IsNotEmpty()
	@MaxLength(1_000_000)
	lastMessage!: string; // base64-encoded

	@IsString()
	@IsNotEmpty()
	@MaxLength(1_000_000)
	messageHash!: string; // base64-encoded
}
