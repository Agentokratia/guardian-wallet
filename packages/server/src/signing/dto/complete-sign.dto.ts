import { IsNotEmpty, IsString } from 'class-validator';

export class CompleteSignDto {
	@IsString()
	@IsNotEmpty()
	sessionId!: string;
}
