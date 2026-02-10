import { ArrayMaxSize, IsArray, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ProcessSignRoundDto {
	@IsString()
	@IsNotEmpty()
	sessionId!: string;

	@IsArray()
	@ArrayMaxSize(100)
	@IsString({ each: true })
	@MaxLength(1_000_000, { each: true })
	messages!: string[]; // base64-encoded
}
