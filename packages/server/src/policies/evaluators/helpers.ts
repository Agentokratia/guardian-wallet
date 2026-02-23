export { EFFECTIVELY_UNLIMITED } from '../../common/transfer-decoder.service.js';

export function safeBigInt(value: string): bigint {
	if (!/^-?\d+$/.test(value)) {
		throw new RangeError(`Invalid BigInt value: ${value}`);
	}
	return BigInt(value);
}

export function compareValues(a: bigint, op: '<' | '<=' | '>' | '>=' | '=', b: bigint): boolean {
	switch (op) {
		case '<=':
			return a <= b;
		case '<':
			return a < b;
		case '>=':
			return a >= b;
		case '>':
			return a > b;
		case '=':
			return a === b;
		default:
			return false;
	}
}
