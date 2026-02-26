import type { Share } from '@agentokratia/guardian-core';
import { describe, expect, it } from 'vitest';
import { wipeShare } from '../share-loader.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeShare(overrides: Partial<Share> = {}): Share {
	return {
		data: new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]),
		participantIndex: 1,
		publicKey: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
		scheme: 'cggmp24' as Share['scheme'],
		curve: 'secp256k1' as Share['curve'],
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('share-loader', () => {
	describe('wipeShare', () => {
		it('zeros the data buffer', () => {
			const share = makeShare({ data: new Uint8Array([1, 2, 3, 4]) });

			wipeShare(share);

			expect(share.data.every((b) => b === 0)).toBe(true);
		});

		it('zeros the publicKey buffer', () => {
			const share = makeShare({ publicKey: new Uint8Array([5, 6, 7, 8]) });

			wipeShare(share);

			expect(share.publicKey.every((b) => b === 0)).toBe(true);
		});

		it('zeros both buffers simultaneously', () => {
			const data = new Uint8Array([1, 2, 3]);
			const publicKey = new Uint8Array([4, 5, 6]);
			const share = makeShare({ data, publicKey });

			wipeShare(share);

			expect(data.every((b) => b === 0)).toBe(true);
			expect(publicKey.every((b) => b === 0)).toBe(true);
		});
	});
});
