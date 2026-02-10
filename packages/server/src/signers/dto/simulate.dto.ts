import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class SimulateDto {
	@Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'to must be a valid Ethereum address' })
	to!: string;

	@IsOptional()
	@Matches(/^\d+(\.\d+)?$/, { message: 'value must be a decimal number string (e.g. "0.01")' })
	value?: string;

	@IsOptional()
	@Matches(/^0x[0-9a-fA-F]*$/, { message: 'data must be a hex string' })
	data?: string;

	@IsString()
	@IsNotEmpty()
	network!: string;
}
