/**
 * Integration test: User+Server signing path (parties [1,2]).
 *
 * This test simulates the browser signing flow in Node.js to isolate
 * whether the "signing protocol error: signing protocol failed" error
 * comes from the WASM protocol itself or from the browser transport layer.
 *
 * Compares:
 * - CLI path: Signer(0) + Server(1) — known working
 * - Browser path: Server(1) + User(2) — currently failing in browser
 *
 * Requires: native binary (for DKG) + WASM module (for signing)
 */

import { keccak256, toHex } from 'viem';
import { describe, expect, it, beforeAll } from 'vitest';
import { CGGMP24Scheme, type DkgResult } from './cggmp24.scheme.js';

// Shared DKG result across all tests (DKG is expensive ~1-15s)
let dkgResult: DkgResult;
let scheme: CGGMP24Scheme;

describe('User+Server signing path (integration)', () => {
	beforeAll(async () => {
		scheme = new CGGMP24Scheme();
		// Initialize WASM for signing
		await scheme.initWasm();
		// Run DKG to get 3 shares: share[0]=signer, share[1]=server, share[2]=user
		console.log('[TEST] Running DKG (3-of-2)...');
		dkgResult = await scheme.runDkg(3, 2);
		console.log(`[TEST] DKG complete. Address: ${scheme.deriveAddress(dkgResult.publicKey)}`);
		console.log(`[TEST] Shares: ${dkgResult.shares.length}`);
	}, 300_000); // 5 min timeout for cold-start DKG

	it('CLI path: Signer(0) + Server(1) signs successfully', async () => {
		// This path works — use as baseline
		const messageHash = makeMessageHash('hello from CLI');
		const eid = randomEid();

		const serverScheme = new CGGMP24Scheme();
		await serverScheme.initWasm();
		const clientScheme = new CGGMP24Scheme();
		await clientScheme.initWasm();

		// Create sessions — same as CLI ThresholdSigner + InteractiveSignService
		const serverSession = await serverScheme.createSignSession(
			[dkgResult.shares[1]!.coreShare, dkgResult.shares[1]!.auxInfo],
			messageHash,
			{ partyIndex: 1, partiesAtKeygen: [0, 1], eid, forceWasm: true },
		);
		const clientSession = await clientScheme.createSignSession(
			[dkgResult.shares[0]!.coreShare, dkgResult.shares[0]!.auxInfo],
			messageHash,
			{ partyIndex: 0, partiesAtKeygen: [0, 1], eid, forceWasm: true },
		);

		console.log(`[CLI] Server first msgs: ${serverSession.firstMessages.length}`);
		console.log(`[CLI] Client first msgs: ${clientSession.firstMessages.length}`);

		// Exchange messages — simulate the round loop
		const result = await exchangeRounds(
			serverScheme, serverSession.sessionId, serverSession.firstMessages,
			clientScheme, clientSession.sessionId, clientSession.firstMessages,
		);

		expect(result.serverComplete).toBe(true);
		expect(result.clientComplete).toBe(true);

		// Finalize both
		const serverSig = await serverScheme.finalizeSign(serverSession.sessionId);
		const clientSig = await clientScheme.finalizeSign(clientSession.sessionId);

		console.log(`[CLI] Server sig: r=${toHex(serverSig.r).slice(0, 10)}... v=${serverSig.v}`);
		console.log(`[CLI] Client sig: r=${toHex(clientSig.r).slice(0, 10)}... v=${clientSig.v}`);

		// Both should produce the same signature
		expect(toHex(serverSig.r)).toBe(toHex(clientSig.r));
		expect(toHex(serverSig.s)).toBe(toHex(clientSig.s));
	}, 120_000);

	it('Browser path: Server(1) + User(2) signs successfully', async () => {
		// This is the path that fails in the browser
		const messageHash = makeMessageHash('hello from browser');
		const eid = randomEid();

		const serverScheme = new CGGMP24Scheme();
		await serverScheme.initWasm();
		const browserScheme = new CGGMP24Scheme();
		await browserScheme.initWasm();

		// Create sessions — same as InteractiveSignService (USER_SERVER path)
		// Server: party 1, Browser: party 2, partiesAtKeygen: [1, 2]
		const serverSession = await serverScheme.createSignSession(
			[dkgResult.shares[1]!.coreShare, dkgResult.shares[1]!.auxInfo],
			messageHash,
			{ partyIndex: 1, partiesAtKeygen: [1, 2], eid, forceWasm: true },
		);
		const browserSession = await browserScheme.createSignSession(
			[dkgResult.shares[2]!.coreShare, dkgResult.shares[2]!.auxInfo],
			messageHash,
			{ partyIndex: 2, partiesAtKeygen: [1, 2], eid, forceWasm: true },
		);

		console.log(`[Browser] Server first msgs: ${serverSession.firstMessages.length}`);
		console.log(`[Browser] Browser first msgs: ${browserSession.firstMessages.length}`);

		// Exchange messages — simulate the round loop
		const result = await exchangeRounds(
			serverScheme, serverSession.sessionId, serverSession.firstMessages,
			browserScheme, browserSession.sessionId, browserSession.firstMessages,
		);

		expect(result.serverComplete).toBe(true);
		expect(result.clientComplete).toBe(true);

		// Finalize both
		const serverSig = await serverScheme.finalizeSign(serverSession.sessionId);
		const browserSig = await browserScheme.finalizeSign(browserSession.sessionId);

		console.log(`[Browser] Server sig: r=${toHex(serverSig.r).slice(0, 10)}... v=${serverSig.v}`);
		console.log(`[Browser] Browser sig: r=${toHex(browserSig.r).slice(0, 10)}... v=${browserSig.v}`);

		// Both should produce the same signature
		expect(toHex(serverSig.r)).toBe(toHex(browserSig.r));
		expect(toHex(serverSig.s)).toBe(toHex(browserSig.s));
	}, 120_000);

	it('Browser path with HTTP-style base64 serialization roundtrip', async () => {
		// Simulate the EXACT serialization path used by browser-signer.ts ↔ signing.controller.ts
		const messageHash = makeMessageHash('hello with base64 roundtrip');
		const eid = randomEid();

		const serverScheme = new CGGMP24Scheme();
		await serverScheme.initWasm();
		const browserScheme = new CGGMP24Scheme();
		await browserScheme.initWasm();

		// Server creates session
		const serverSession = await serverScheme.createSignSession(
			[dkgResult.shares[1]!.coreShare, dkgResult.shares[1]!.auxInfo],
			messageHash,
			{ partyIndex: 1, partiesAtKeygen: [1, 2], eid, forceWasm: true },
		);

		// Controller serializes firstMessages to base64 (as done in signing.controller.ts)
		const serverFirstMessagesBase64 = serverSession.firstMessages.map(bytesToBase64);

		// Browser receives base64, decodes, parses JSON to WasmSignMessage[]
		const serverFirstParsed = serverFirstMessagesBase64.map((b64) => {
			const bytes = base64ToBytes(b64);
			return JSON.parse(new TextDecoder().decode(bytes));
		});

		// Browser creates its own session (same as browser-signer.ts)
		const browserSession = await browserScheme.createSignSession(
			[dkgResult.shares[2]!.coreShare, dkgResult.shares[2]!.auxInfo],
			messageHash,
			{ partyIndex: 2, partiesAtKeygen: [1, 2], eid, forceWasm: true },
		);

		// Browser serializes its first messages to WasmSignMessage[]
		const browserFirstParsed = browserSession.firstMessages.map((bytes) =>
			JSON.parse(new TextDecoder().decode(bytes)),
		);

		// Browser processes server's first messages via WASM
		// First re-serialize for processSignRound (expects Uint8Array[])
		const serverFirstBytes = serverFirstParsed.map((msg: unknown) =>
			new TextEncoder().encode(JSON.stringify(msg)),
		);
		const processResult = await browserScheme.processSignRound(
			browserSession.sessionId,
			serverFirstBytes,
		);

		console.log(`[B64] Browser processResult: complete=${processResult.complete} outgoing=${processResult.outgoingMessages.length}`);

		// Combine browser first messages + processResult messages (as browser-signer.ts does)
		const browserFirstBytes = browserFirstParsed.map((msg: unknown) =>
			new TextEncoder().encode(JSON.stringify(msg)),
		);
		let outgoing = [...browserFirstBytes, ...processResult.outgoingMessages];

		// Round loop (simulating browser-signer.ts round exchange)
		const MAX_ROUNDS = 20;
		let serverComplete = false;
		let roundCount = 0;

		while (!serverComplete) {
			if (++roundCount > MAX_ROUNDS) {
				throw new Error(`Protocol did not complete after ${MAX_ROUNDS} rounds`);
			}

			// Browser → base64 → Server (as browser-signer.ts + signing.controller.ts)
			const outgoingBase64 = outgoing.map(bytesToBase64);
			const incomingForServer = outgoingBase64.map(base64ToBytes);

			// Server processes
			const serverResult = await serverScheme.processSignRound(
				serverSession.sessionId,
				incomingForServer,
			);

			serverComplete = serverResult.complete;
			console.log(`[B64] Round ${roundCount}: server complete=${serverComplete} outgoing=${serverResult.outgoingMessages.length}`);

			if (serverResult.outgoingMessages.length > 0 && !serverComplete) {
				// Server → base64 → Browser
				const serverOutBase64 = serverResult.outgoingMessages.map(bytesToBase64);
				const incomingForBrowser = serverOutBase64.map((b64) =>
					new TextEncoder().encode(
						JSON.stringify(JSON.parse(new TextDecoder().decode(base64ToBytes(b64)))),
					),
				);

				const browserResult = await browserScheme.processSignRound(
					browserSession.sessionId,
					incomingForBrowser,
				);

				outgoing = browserResult.outgoingMessages;
				console.log(`[B64] Round ${roundCount}: browser complete=${browserResult.complete} outgoing=${browserResult.outgoingMessages.length}`);
			} else {
				outgoing = [];
			}
		}

		// Finalize
		const serverSig = await serverScheme.finalizeSign(serverSession.sessionId);
		console.log(`[B64] Server sig: r=${toHex(serverSig.r).slice(0, 10)}... v=${serverSig.v}`);

		expect(serverSig.v).toBeGreaterThanOrEqual(27);
		expect(serverSig.v).toBeLessThanOrEqual(28);
		expect(serverSig.r.length).toBe(32);
		expect(serverSig.s.length).toBe(32);
	}, 120_000);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessageHash(msg: string): Uint8Array {
	const hex = keccak256(toHex(new TextEncoder().encode(msg)));
	return new Uint8Array(Buffer.from(hex.slice(2), 'hex'));
}

function randomEid(): Uint8Array {
	const eid = new Uint8Array(32);
	crypto.getRandomValues(eid);
	return eid;
}

function bytesToBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(b64: string): Uint8Array {
	return new Uint8Array(Buffer.from(b64, 'base64'));
}

/**
 * Exchange messages between two scheme instances until both complete.
 * Simulates the round loop in both the CLI and browser paths.
 */
async function exchangeRounds(
	schemeA: CGGMP24Scheme,
	sessionIdA: string,
	firstMessagesA: Uint8Array[],
	schemeB: CGGMP24Scheme,
	sessionIdB: string,
	firstMessagesB: Uint8Array[],
): Promise<{ serverComplete: boolean; clientComplete: boolean; rounds: number }> {
	// Each side processes the other's first messages
	const resultA = await schemeA.processSignRound(sessionIdA, firstMessagesB);
	const resultB = await schemeB.processSignRound(sessionIdB, firstMessagesA);

	let outgoingA = resultA.outgoingMessages;
	let outgoingB = resultB.outgoingMessages;
	let completeA = resultA.complete;
	let completeB = resultB.complete;

	console.log(`  Round 0: A complete=${completeA} outA=${outgoingA.length} | B complete=${completeB} outB=${outgoingB.length}`);

	const MAX_ROUNDS = 20;
	let round = 0;

	while (!completeA || !completeB) {
		if (++round > MAX_ROUNDS) {
			throw new Error(`Protocol did not complete after ${MAX_ROUNDS} rounds`);
		}

		// Save previous outgoing before processing (both sides process simultaneously)
		const prevOutA = outgoingA;
		const prevOutB = outgoingB;

		// A processes B's previous messages
		if (prevOutB.length > 0 && !completeA) {
			const resA = await schemeA.processSignRound(sessionIdA, prevOutB);
			outgoingA = resA.outgoingMessages;
			completeA = resA.complete;
		} else {
			outgoingA = [];
		}

		// B processes A's previous messages (not the new ones from this round!)
		if (prevOutA.length > 0 && !completeB) {
			const resB = await schemeB.processSignRound(sessionIdB, prevOutA);
			outgoingB = resB.outgoingMessages;
			completeB = resB.complete;
		} else {
			outgoingB = [];
		}

		console.log(`  Round ${round}: A complete=${completeA} outA=${outgoingA.length} | B complete=${completeB} outB=${outgoingB.length}`);

		// Safety: if both have no outgoing and neither is complete, we're stuck
		if (outgoingA.length === 0 && outgoingB.length === 0 && (!completeA || !completeB)) {
			throw new Error(`Protocol stuck at round ${round}: A=${completeA} B=${completeB}`);
		}
	}

	return { serverComplete: completeA, clientComplete: completeB, rounds: round };
}
