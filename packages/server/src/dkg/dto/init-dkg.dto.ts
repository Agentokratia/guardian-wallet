import { IsNotEmpty, IsString } from 'class-validator';

export class InitDkgDto {
	@IsString()
	@IsNotEmpty()
	signerId!: string;
}
