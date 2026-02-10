import { describe, expect, it } from 'vitest';
import { decodeCalldata } from './ethereum.decoder.js';

describe('decodeCalldata', () => {
	it('returns undefined for data shorter than 4 bytes', () => {
		expect(decodeCalldata(new Uint8Array([0x01, 0x02]))).toBeUndefined();
		expect(decodeCalldata(new Uint8Array([]))).toBeUndefined();
	});

	it('decodes known ERC20 transfer selector', () => {
		// 0xa9059cbb = transfer(address,uint256)
		const data = new Uint8Array([0xa9, 0x05, 0x9c, 0xbb, 0x00, 0x00]);
		const result = decodeCalldata(data);
		expect(result).toBeDefined();
		expect(result?.selector).toBe('0xa9059cbb');
		expect(result?.name).toBe('transfer(address,uint256)');
	});

	it('decodes known approve selector', () => {
		// 0x095ea7b3 = approve(address,uint256)
		const data = new Uint8Array([0x09, 0x5e, 0xa7, 0xb3]);
		const result = decodeCalldata(data);
		expect(result).toBeDefined();
		expect(result?.selector).toBe('0x095ea7b3');
		expect(result?.name).toBe('approve(address,uint256)');
	});

	it('returns unknown for unrecognized selector', () => {
		const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
		const result = decodeCalldata(data);
		expect(result).toBeDefined();
		expect(result?.selector).toBe('0xdeadbeef');
		expect(result?.name).toBe('unknown(0xdeadbeef)');
	});
});
