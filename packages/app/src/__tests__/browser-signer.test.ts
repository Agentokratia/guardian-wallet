import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock variables
// ---------------------------------------------------------------------------

const { mockApiPost, mockWasm } = vi.hoisted(() => {
	const mockApiPost = vi.fn();

	const mockWasm = {
		default: vi.fn(),
		sign_create_session: vi.fn(() => ({
			session_id: 'wasm-session-1',
			messages: [
				{ sender: 2, is_broadcast: true, recipient: null, payload: 'msg1' },
			],
		})),
		sign_process_round: vi.fn(() => ({
			messages: [
				{ sender: 2, is_broadcast: false, recipient: 1, payload: 'msg2' },
			],
			complete: false,
		})),
		sign_destroy_session: vi.fn(),
	};

	return { mockApiPost, mockWasm };
});

// ---------------------------------------------------------------------------
// Mock the WASM module (browser-signer imports this directly, not schemes)
// ---------------------------------------------------------------------------

vi.mock('@agentokratia/guardian-mpc-wasm', () => mockWasm);

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
	ApiError: class ApiError extends Error {
		status: number;
		constructor(status: number, message: string) {
			super(message);
			this.status = status;
			this.name = 'ApiError';
		}
	},
	authEvents: new EventTarget(),
	AUTH_EXPIRED_EVENT: 'auth:expired',
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

/** Helper: encode a WasmSignMessage as base64 JSON (matches server response) */
function encodeWasmMsg(msg: { sender: number; is_broadcast: boolean; recipient: number | null; payload: string }): string {
	return btoa(JSON.stringify(msg));
}

/** Helper: make a standard session response with the new API shape */
function makeSessionResponse(overrides: Record<string, unknown> = {}) {
	return {
		sessionId: 'session-123',
		serverFirstMessages: [
			encodeWasmMsg({ sender: 1, is_broadcast: true, recipient: null, payload: 'server-first' }),
		],
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
		mockWasm.sign_create_session.mockClear();
		mockWasm.sign_process_round.mockClear();
		mockWasm.sign_destroy_session.mockClear();

		// Reset WASM mock return values
		mockWasm.sign_create_session.mockReturnValue({
			session_id: 'wasm-session-1',
			messages: [
				{ sender: 2, is_broadcast: true, recipient: null, payload: 'client-first' },
			],
		});
		mockWasm.sign_process_round.mockReturnValue({
			messages: [],
			complete: false,
		});

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

		// 1st call: session creation
		expect(mockApiPost.mock.calls[0][0]).toBe(`/signers/${signerId}/sign/session`);
		expect(mockApiPost.mock.calls[0][1]).toHaveProperty('transaction');

		// 2nd call: round
		expect(mockApiPost.mock.calls[1][0]).toBe(`/signers/${signerId}/sign/round`);
		expect(mockApiPost.mock.calls[1][1]).toHaveProperty('sessionId', 'session-123');

		// 3rd call: complete
		expect(mockApiPost.mock.calls[2][0]).toBe(`/signers/${signerId}/sign/complete`);
		expect(mockApiPost.mock.calls[2][1]).toHaveProperty('sessionId', 'session-123');
	});

	it('creates WASM session with correct hash and party config from server', async () => {
		const shareBytes = makeKeyMaterialBytes();

		await browserInteractiveSign(shareBytes, signerId, transaction);

		expect(mockWasm.sign_create_session).toHaveBeenCalledWith(
			expect.any(Uint8Array), // coreShare
			expect.any(Uint8Array), // auxInfo
			expect.any(Uint8Array), // messageHash
			2, // clientPartyIndex
			expect.any(Uint16Array), // partiesAtKeygen
			expect.any(Uint8Array), // eid
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

	it('destroys WASM session in finally block', async () => {
		const shareBytes = makeKeyMaterialBytes();

		await browserInteractiveSign(shareBytes, signerId, transaction);

		expect(mockWasm.sign_destroy_session).toHaveBeenCalledWith('wasm-session-1');
	});

	it('handles multiple rounds correctly', async () => {
		mockApiPost.mockReset();

		// Session creation
		mockApiPost.mockResolvedValueOnce(makeSessionResponse({ sessionId: 'session-multi' }));

		// Round 1: server returns messages, not complete
		mockApiPost.mockResolvedValueOnce({
			messages: [
				encodeWasmMsg({ sender: 1, is_broadcast: false, recipient: 2, payload: 'round1' }),
			],
			roundsRemaining: 1,
			complete: false,
		});

		// Round 2: complete
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
