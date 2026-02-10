import { IsNotEmpty, IsString } from 'class-validator';

export class FinalizeDkgDto {
	@IsString()
	@IsNotEmpty()
	sessionId!: string;

	@IsString()
	@IsNotEmpty()
	signerId!: string;
}
