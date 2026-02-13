import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock variables
// ---------------------------------------------------------------------------

const { mockApiPost, mockSchemeInstance } = vi.hoisted(() => {
	const mockApiPost = vi.fn();

	const mockSchemeInstance = {
		createSignSession: vi.fn(async () => ({
			sessionId: 'scheme-session-1',
			firstMessages: [new Uint8Array([10, 20, 30])],
		})),
		processSignRound: vi.fn(async () => ({
			outgoingMessages: [new Uint8Array([40, 50, 60])],
			complete: false,
		})),
		finalizeSign: vi.fn(async () => ({
			r: new Uint8Array(32).fill(0xaa),
			s: new Uint8Array(32).fill(0xbb),
			v: 27,
		})),
	};

	return { mockApiPost, mockSchemeInstance };
});

// ---------------------------------------------------------------------------
// Mock the schemes module (CGGMP24Scheme)
// ---------------------------------------------------------------------------

vi.mock('@agentokratia/guardian-schemes', () => ({
	CGGMP24Scheme: vi.fn(() => mockSchemeInstance),
}));

// ---------------------------------------------------------------------------
// Mock the api-client
// ---------------------------------------------------------------------------

vi.mock('../lib/api-client', () => ({
	api: {
		get: vi.fn(),
		post: mockApiPost,
		patch: vi.fn(),
		del: vi.fn(),
	},
}));

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------

import { browserInteractiveSign } from '../lib/browser-signer';

// ---------------------------------------------------------------------------
// Helper: create valid CGGMP24 key material as user share bytes
// ---------------------------------------------------------------------------

function makeKeyMaterialBytes(): Uint8Array {
	const json = JSON.stringify({
		coreShare: btoa(String.fromCharCode(...new Uint8Array(64).fill(1))),
		auxInfo: btoa(String.fromCharCode(...new Uint8Array(32).fill(2))),
	});
	return new TextEncoder().encode(json);
}

/** Helper: base64 encode a byte array (browser-compatible) */
function toBase64(bytes: number[]): string {
	return btoa(String.fromCharCode(...bytes));
}

/** Helper: make a standard session response with the new API shape */
function makeSessionResponse(overrides: Record<string, unknown> = {}) {
	return {
		sessionId: 'session-123',
		serverFirstMessages: [toBase64([10, 20, 30])],
		messageHash: toBase64(new Array(32).fill(0xab)),
		eid: toBase64(new Array(32).fill(0xcd)),
		partyConfig: {
			serverPartyIndex: 1,
			clientPartyIndex: 2,
			partiesAtKeygen: [1, 2],
		},
		roundsRemaining: 4,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('browserInteractiveSign', () => {
	const signerId = 'signer-abc';
	const transaction = {
		to: '0xdef456',
		value: '1000000000000000',
		chainId: 11155111,
	};

	beforeEach(() => {
		mockApiPost.mockReset();
		mockSchemeInstance.createSignSession.mockClear();
		mockSchemeInstance.processSignRound.mockClear();

		// Call 1: POST /signers/:id/sign/session — new response shape
		mockApiPost.mockResolvedValueOnce(makeSessionResponse());

		// Call 2: POST /signers/:id/sign/round (complete=true to end loop)
		mockApiPost.mockResolvedValueOnce({
			messages: [],
			roundsRemaining: 0,
			complete: true,
		});

		// Call 3: POST /signers/:id/sign/complete
		mockApiPost.mockResolvedValueOnce({
			txHash: '0xtxhash999',
			signature: { r: '0xaaa', s: '0xbbb', v: 27 },
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('calls API endpoints in correct order', async () => {
		const shareBytes = makeKeyMaterialBytes();

		await browserInteractiveSign(shareBytes, signerId, transaction);

		expect(mockApiPost).toHaveBeenCalledTimes(3);

		// 1st call: session creation — no signerFirstMessage (server computes hash)
		expect(mockApiPost.mock.calls[0][0]).toBe(`/signers/${signerId}/sign/session`);
		expect(mockApiPost.mock.calls[0][1]).toHaveProperty('transaction');
		expect(mockApiPost.mock.calls[0][1]).not.toHaveProperty('signerFirstMessage');

		// 2nd call: round
		expect(mockApiPost.mock.calls[1][0]).toBe(`/signers/${signerId}/sign/round`);
		expect(mockApiPost.mock.calls[1][1]).toHaveProperty('sessionId', 'session-123');

		// 3rd call: complete (no lastMessage or messageHash — CGGMP24)
		expect(mockApiPost.mock.calls[2][0]).toBe(`/signers/${signerId}/sign/complete`);
		expect(mockApiPost.mock.calls[2][1]).toHaveProperty('sessionId', 'session-123');
		expect(mockApiPost.mock.calls[2][1]).not.toHaveProperty('lastMessage');
		expect(mockApiPost.mock.calls[2][1]).not.toHaveProperty('messageHash');
	});

	it('creates local session with correct hash and party config from server', async () => {
		const shareBytes = makeKeyMaterialBytes();

		await browserInteractiveSign(shareBytes, signerId, transaction);

		// createSignSession should be called with messageHash from server, plus options
		expect(mockSchemeInstance.createSignSession).toHaveBeenCalledWith(
			expect.any(Array), // [coreShare, auxInfo]
			expect.any(Uint8Array), // messageHash from server
			expect.objectContaining({
				partyIndex: 2, // clientPartyIndex for USER_SERVER
				partiesAtKeygen: [1, 2],
				eid: expect.any(Uint8Array),
			}),
		);
	});

	it('returns txHash and signature from server', async () => {
		const shareBytes = makeKeyMaterialBytes();

		const result = await browserInteractiveSign(shareBytes, signerId, transaction);

		expect(result.txHash).toBe('0xtxhash999');
		expect(result.signature).toEqual({ r: '0xaaa', s: '0xbbb', v: 27 });
	});

	it('wipes share bytes after successful signing', async () => {
		const shareBytes = makeKeyMaterialBytes();
		const originalLength = shareBytes.length;

		await browserInteractiveSign(shareBytes, signerId, transaction);

		expect(shareBytes.every((b) => b === 0)).toBe(true);
		expect(shareBytes.length).toBe(originalLength);
	});

	it('wipes share bytes even when API call fails', async () => {
		mockApiPost.mockReset();
		mockApiPost.mockRejectedValueOnce(new Error('Network error'));

		const shareBytes = makeKeyMaterialBytes();

		await expect(
			browserInteractiveSign(shareBytes, signerId, transaction),
		).rejects.toThrow('Network error');

		expect(shareBytes.every((b) => b === 0)).toBe(true);
	});

	it('handles multiple rounds correctly', async () => {
		mockApiPost.mockReset();

		// Session creation — new response shape
		mockApiPost.mockResolvedValueOnce(makeSessionResponse({ sessionId: 'session-multi' }));

		// Round exchange
		mockSchemeInstance.processSignRound
			.mockResolvedValueOnce({ outgoingMessages: [new Uint8Array([1])], complete: false })
			.mockResolvedValueOnce({ outgoingMessages: [new Uint8Array([2])], complete: false })
			.mockResolvedValueOnce({ outgoingMessages: [new Uint8Array([3])], complete: false });

		mockApiPost.mockResolvedValueOnce({
			messages: [toBase64([4, 5, 6])],
			roundsRemaining: 1,
			complete: false,
		});

		// Round 2: done
		mockApiPost.mockResolvedValueOnce({
			messages: [],
			roundsRemaining: 0,
			complete: true,
		});

		// Complete
		mockApiPost.mockResolvedValueOnce({
			txHash: '0xmultihash',
			signature: { r: '0x111', s: '0x222', v: 28 },
		});

		const shareBytes = makeKeyMaterialBytes();

		const result = await browserInteractiveSign(shareBytes, signerId, transaction);

		expect(mockApiPost).toHaveBeenCalledTimes(4);
		expect(result.txHash).toBe('0xmultihash');
	});
});
