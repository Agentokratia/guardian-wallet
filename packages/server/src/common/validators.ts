import {
	type ValidationArguments,
	ValidatorConstraint,
	type ValidatorConstraintInterface,
} from 'class-validator';
import { isAddress } from 'viem';

@ValidatorConstraint({ name: 'isEvmAddress', async: false })
export class IsEvmAddress implements ValidatorConstraintInterface {
	validate(value: unknown): boolean {
		return typeof value === 'string' && isAddress(value);
	}

	defaultMessage(args: ValidationArguments): string {
		return `${args.property} must be a valid EVM address`;
	}
}
