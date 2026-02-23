import { IsNotEmpty, IsOptional, IsString, Matches, Validate } from 'class-validator';
import { IsEvmAddress } from '../../common/validators.js';

export class SimulateDto {
	@IsString()
	@Validate(IsEvmAddress)
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
