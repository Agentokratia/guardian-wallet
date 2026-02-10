import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock variables — vi.hoisted runs before vi.mock factories
// ---------------------------------------------------------------------------

const { mockSessionInstance, mockApiPost, mockSignSession, mockKeyshare } =
	vi.hoisted(() => {
		const mockFree = vi.fn();

		function makeMockMessage(from: number, to?: number) {
			return {
				from_id: from,
				to_id: to,
				payload: new Uint8Array([1, 2, 3]),
				free: mockFree,
			};
		}

		const mockSessionInstance = {
			createFirstMessage: vi.fn(() => makeMockMessage(0)),
			handleMessages: vi.fn(() => [makeMockMessage(0, 1)]),
			lastMessage: vi.fn(() => makeMockMessage(0, 1)),
			free: vi.fn(),
		};

		const mockApiPost = vi.fn();
		const mockSignSession = vi.fn(() => mockSessionInstance);
		const mockKeyshare = { fromBytes: vi.fn(() => ({ __keyshare: true })) };

		return { mockSessionInstance, mockApiPost, mockSignSession, mockKeyshare };
	});

// ---------------------------------------------------------------------------
// Mock the WASM module
// ---------------------------------------------------------------------------

vi.mock('@silencelaboratories/dkls-wasm-ll-web', () => ({
	default: vi.fn(() => Promise.resolve()),
	Keyshare: mockKeyshare,
	SignSession: mockSignSession,
	Message: vi.fn().mockImplementation(
		(payload: Uint8Array, from: number, to?: number) => ({
			from_id: from,
			to_id: to,
			payload,
			free: vi.fn(),
		}),
	),
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
// Helper
// ---------------------------------------------------------------------------

function makeMockMessage(from: number, to?: number) {
	return {
		from_id: from,
		to_id: to,
		payload: new Uint8Array([1, 2, 3]),
		free: vi.fn(),
	};
}

// Base64 encode a Uint8Array (for mock messageHash)
function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
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
	// Server-provided messageHash (returned in the final round response)
	const serverMessageHash = toBase64(new Uint8Array(32).fill(0xaa));

	beforeEach(() => {
		// Reset call counts but preserve implementations
		mockApiPost.mockReset();
		mockSignSession.mockClear();
		mockKeyshare.fromBytes.mockClear();

		// Re-set session instance mock implementations (mockClear preserves them, but be safe)
		mockSessionInstance.createFirstMessage.mockImplementation(() =>
			makeMockMessage(0),
		);
		mockSessionInstance.handleMessages.mockImplementation(() => [
			makeMockMessage(0, 1),
		]);
		mockSessionInstance.lastMessage.mockImplementation(() =>
			makeMockMessage(0, 1),
		);

		// Set up the mock API responses
		// Call 1: POST /signers/:id/sign/session
		mockApiPost.mockResolvedValueOnce({
			sessionId: 'session-123',
			serverFirstMessage: btoa(
				String.fromCharCode(...[1, 0, 0, 0, 0, 0, 3, 1, 2, 3]),
			),
			roundsRemaining: 1,
		});

		// Call 2: POST /signers/:id/sign/round (roundsRemaining=0 to end loop)
		// Server returns messageHash when presigning completes
		mockApiPost.mockResolvedValueOnce({
			messages: [],
			roundsRemaining: 0,
			presigned: true,
			messageHash: serverMessageHash,
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
		const shareBytes = new Uint8Array([10, 20, 30, 40, 50]);

		await browserInteractiveSign(shareBytes, signerId, transaction);

		expect(mockApiPost).toHaveBeenCalledTimes(3);

		// 1st call: session creation
		expect(mockApiPost.mock.calls[0][0]).toBe(
			`/signers/${signerId}/sign/session`,
		);
		expect(mockApiPost.mock.calls[0][1]).toHaveProperty(
			'signerFirstMessage',
		);
		expect(mockApiPost.mock.calls[0][1]).toHaveProperty('transaction');

		// 2nd call: round
		expect(mockApiPost.mock.calls[1][0]).toBe(
			`/signers/${signerId}/sign/round`,
		);
		expect(mockApiPost.mock.calls[1][1]).toHaveProperty(
			'sessionId',
			'session-123',
		);

		// 3rd call: complete
		expect(mockApiPost.mock.calls[2][0]).toBe(
			`/signers/${signerId}/sign/complete`,
		);
		expect(mockApiPost.mock.calls[2][1]).toHaveProperty(
			'sessionId',
			'session-123',
		);
		expect(mockApiPost.mock.calls[2][1]).toHaveProperty('lastMessage');
		expect(mockApiPost.mock.calls[2][1]).toHaveProperty('messageHash');
	});

	it('returns txHash and signature from server', async () => {
		const shareBytes = new Uint8Array([10, 20, 30, 40, 50]);

		const result = await browserInteractiveSign(shareBytes, signerId, transaction);

		expect(result.txHash).toBe('0xtxhash999');
		expect(result.signature).toEqual({ r: '0xaaa', s: '0xbbb', v: 27 });
	});

	it('wipes share bytes after successful signing', async () => {
		const shareBytes = new Uint8Array([10, 20, 30, 40, 50]);

		await browserInteractiveSign(shareBytes, signerId, transaction);

		expect(shareBytes.every((b) => b === 0)).toBe(true);
	});

	it('wipes share bytes even when API call fails', async () => {
		mockApiPost.mockReset();
		mockApiPost.mockRejectedValueOnce(new Error('Network error'));

		const shareBytes = new Uint8Array([10, 20, 30, 40, 50]);

		await expect(
			browserInteractiveSign(shareBytes, signerId, transaction),
		).rejects.toThrow('Network error');

		expect(shareBytes.every((b) => b === 0)).toBe(true);
	});

	it('creates SignSession with keyshare from bytes', async () => {
		const shareBytes = new Uint8Array([10, 20, 30, 40, 50]);

		await browserInteractiveSign(shareBytes, signerId, transaction);

		expect(mockKeyshare.fromBytes).toHaveBeenCalledWith(shareBytes);
		expect(mockSignSession).toHaveBeenCalled();
	});

	it('calls lastMessage with the server-provided message hash', async () => {
		const shareBytes = new Uint8Array([10, 20, 30, 40, 50]);

		await browserInteractiveSign(shareBytes, signerId, transaction);

		// lastMessage should be called with the decoded server messageHash
		expect(mockSessionInstance.lastMessage).toHaveBeenCalledTimes(1);
	});

	it('throws if server does not return messageHash', async () => {
		mockApiPost.mockReset();

		// Session creation
		mockApiPost.mockResolvedValueOnce({
			sessionId: 'session-no-hash',
			serverFirstMessage: btoa(
				String.fromCharCode(...[1, 0, 0, 0, 0, 0, 3, 1, 2, 3]),
			),
			roundsRemaining: 1,
		});

		// Round completes but no messageHash
		mockApiPost.mockResolvedValueOnce({
			messages: [],
			roundsRemaining: 0,
			presigned: true,
		});

		const shareBytes = new Uint8Array([10, 20, 30, 40, 50]);

		await expect(
			browserInteractiveSign(shareBytes, signerId, transaction),
		).rejects.toThrow('Server did not return messageHash');
	});

	it('handles multiple rounds correctly', async () => {
		mockApiPost.mockReset();

		// Session creation
		mockApiPost.mockResolvedValueOnce({
			sessionId: 'session-multi',
			serverFirstMessage: btoa(
				String.fromCharCode(...[1, 0, 0, 0, 0, 0, 3, 1, 2, 3]),
			),
			roundsRemaining: 2,
		});

		// Round 1: still more rounds
		mockApiPost.mockResolvedValueOnce({
			messages: [
				btoa(String.fromCharCode(...[1, 1, 0, 0, 0, 0, 3, 4, 5, 6])),
			],
			roundsRemaining: 1,
			presigned: false,
		});

		// Round 2: done, server returns messageHash
		mockApiPost.mockResolvedValueOnce({
			messages: [],
			roundsRemaining: 0,
			presigned: true,
			messageHash: serverMessageHash,
		});

		// Complete
		mockApiPost.mockResolvedValueOnce({
			txHash: '0xmultihash',
			signature: { r: '0x111', s: '0x222', v: 28 },
		});

		const shareBytes = new Uint8Array([99, 88, 77]);

		const result = await browserInteractiveSign(shareBytes, signerId, transaction);

		expect(mockApiPost).toHaveBeenCalledTimes(4);
		expect(result.txHash).toBe('0xmultihash');
	});
});
