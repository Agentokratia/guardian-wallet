/**
 * Browser-side interactive CGGMP24 signing for the User+Server path.
 *
 * Calls the WASM module directly (not through the schemes package which
 * has Node.js-only code paths). The WASM binary URL is resolved at import
 * time using Vite's ?url suffix so it works correctly in dev and prod.
 *
 * THE FULL PRIVATE KEY NEVER EXISTS — signing is a distributed computation
 * between user share (browser) and server share (server).
 */

import { api } from './api-client';
import { fromBase64, toBase64 } from './encoding';

interface TransactionParams {
	to: string;
	value?: string;
	data?: string;
	chainId: number;
	gasLimit?: string;
	gasPrice?: string;
	maxFeePerGas?: string;
	maxPriorityFeePerGas?: string;
	nonce?: number;
}

interface SignResult {
	txHash: string;
	signature: { r: string; s: string; v: number };
}

interface SessionResponse {
	sessionId: string;
	serverFirstMessages: string[];
	messageHash: string; // base64
	eid: string; // base64
	partyConfig: {
		serverPartyIndex: number;
		clientPartyIndex: number;
		partiesAtKeygen: number[];
	};
	roundsRemaining: number;
}

interface RoundResponse {
	messages: string[];
	roundsRemaining: number;
	complete: boolean;
}

/** WASM signing session result */
interface WasmCreateSessionResult {
	session_id: string;
	messages: WasmSignMessage[];
}

interface WasmSignMessage {
	sender: number;
	is_broadcast: boolean;
	recipient: number | null;
	payload: string;
}

interface WasmProcessRoundResult {
	messages: WasmSignMessage[];
	complete: boolean;
	signature?: { r: number[]; s: number[] };
}

// ---------------------------------------------------------------------------
// WASM module — initialized once with explicit URL
// ---------------------------------------------------------------------------

type WasmExports = typeof import('@agentokratia/guardian-mpc-wasm');
let wasmReady: Promise<WasmExports> | null = null;

async function ensureWasm(): Promise<WasmExports> {
	if (!wasmReady) {
		wasmReady = (async () => {
			const mod = await import('@agentokratia/guardian-mpc-wasm');
			if (typeof mod.default === 'function') {
				// Construct explicit URL to the .wasm binary.
				// Vite transforms `new URL(path, import.meta.url)` at build time.
				// Path: packages/app/src/lib/ → packages/mpc-wasm/pkg-web/
				const wasmUrl = new URL(
					'../../../mpc-wasm/pkg-web/guardian_mpc_wasm_bg.wasm',
					import.meta.url,
				);
				await mod.default(wasmUrl);
			}
			return mod;
		})();
	}
	return wasmReady;
}

// ---------------------------------------------------------------------------
// Key material parsing
// ---------------------------------------------------------------------------

/**
 * Parse CGGMP24 key material from the decrypted user share.
 * Format: JSON { coreShare: base64, auxInfo: base64 }
 */
function parseKeyMaterial(shareBytes: Uint8Array): { coreShare: Uint8Array; auxInfo: Uint8Array } {
	const json = new TextDecoder().decode(shareBytes);
	const parsed = JSON.parse(json) as { coreShare: string; auxInfo: string };
	return {
		coreShare: fromBase64(parsed.coreShare),
		auxInfo: fromBase64(parsed.auxInfo),
	};
}

// ---------------------------------------------------------------------------
// Browser interactive signing
// ---------------------------------------------------------------------------

/**
 * Run interactive CGGMP24 signing in the browser (User + Server path).
 *
 * Protocol:
 * 1. Send transaction to server (no first message — server computes hash)
 * 2. Receive messageHash, eid, partyConfig, serverFirstMessages from server
 * 3. Create local sign session with correct hash + party config
 * 4. Process server's first messages, exchange rounds until complete
 * 5. Server extracts signature when protocol completes and broadcasts
 * 6. Returns { txHash, signature }
 *
 * THE FULL PRIVATE KEY NEVER EXISTS — signing is a distributed computation.
 */
export async function browserInteractiveSign(
	userShareBytes: Uint8Array,
	signerId: string,
	transaction: TransactionParams,
): Promise<SignResult> {
	// Parse key material from decrypted share
	const keyMaterial = parseKeyMaterial(userShareBytes);
	let wasmSessionId: string | undefined;

	try {
		// Initialize WASM module (browser web build)
		const wasm = await ensureWasm();

		// 1. Send session creation request to server (no first message)
		const sessionRes = await api.post<SessionResponse>(`/signers/${signerId}/sign/session`, {
			transaction,
		});
		const { sessionId } = sessionRes;

		// 2. Create local WASM sign session with correct hash + party config
		const messageHash = fromBase64(sessionRes.messageHash);
		const eid = fromBase64(sessionRes.eid);
		const { clientPartyIndex, partiesAtKeygen } = sessionRes.partyConfig;

		if (import.meta.env.DEV)
			console.log('[sign] Creating browser WASM session:', { clientPartyIndex, partiesAtKeygen });
		const createResult = wasm.sign_create_session(
			keyMaterial.coreShare,
			keyMaterial.auxInfo,
			messageHash,
			clientPartyIndex,
			new Uint16Array(partiesAtKeygen),
			eid,
		) as WasmCreateSessionResult;

		wasmSessionId = createResult.session_id;
		if (import.meta.env.DEV)
			console.log('[sign] Browser session created, first msgs:', createResult.messages.length);

		// 3. Process server's first messages
		const serverFirstMsgs = sessionRes.serverFirstMessages.map(fromBase64);
		const serverFirstParsed: WasmSignMessage[] = serverFirstMsgs.map(
			(bytes) => JSON.parse(new TextDecoder().decode(bytes)) as WasmSignMessage,
		);

		if (import.meta.env.DEV)
			console.log('[sign] Processing server first msgs:', serverFirstParsed.length);
		const processResult = wasm.sign_process_round(
			wasmSessionId,
			serverFirstParsed,
		) as WasmProcessRoundResult;
		if (import.meta.env.DEV)
			console.log(
				'[sign] After processing server first msgs: outgoing=',
				processResult.messages.length,
				'complete=',
				processResult.complete,
			);

		// Combine browser's first messages + messages from processing server's first
		let outgoing: WasmSignMessage[] = [...createResult.messages, ...processResult.messages];

		if (import.meta.env.DEV) console.log('[sign] Combined outgoing for round 1:', outgoing.length);

		// 4. Exchange rounds until server reports complete (max 20 round-trips)
		const MAX_ROUNDS = 20;
		let serverComplete = false;
		let roundCount = 0;

		while (!serverComplete) {
			if (++roundCount > MAX_ROUNDS) {
				throw new Error(`Signing protocol did not complete after ${MAX_ROUNDS} rounds`);
			}

			// Serialize outgoing to base64 for the server
			const outgoingBase64 = outgoing.map((msg) =>
				toBase64(new TextEncoder().encode(JSON.stringify(msg))),
			);

			if (import.meta.env.DEV)
				console.log(`[sign] Round ${roundCount}: sending ${outgoingBase64.length} msgs to server`);
			const roundRes = await api.post<RoundResponse>(`/signers/${signerId}/sign/round`, {
				sessionId,
				messages: outgoingBase64,
			});

			serverComplete = roundRes.complete;
			if (import.meta.env.DEV)
				console.log(
					`[sign] Round ${roundCount}: server returned ${roundRes.messages.length} msgs, complete=${serverComplete}`,
				);

			// Always process server messages (even on the final round)
			if (roundRes.messages.length > 0) {
				const serverMsgs: WasmSignMessage[] = roundRes.messages.map(
					(b64) => JSON.parse(new TextDecoder().decode(fromBase64(b64))) as WasmSignMessage,
				);
				const roundResult = wasm.sign_process_round(
					wasmSessionId,
					serverMsgs,
				) as WasmProcessRoundResult;
				outgoing = roundResult.messages;
				if (import.meta.env.DEV)
					console.log(
						`[sign] Round ${roundCount}: browser produced ${outgoing.length} msgs, browserComplete=${roundResult.complete}`,
					);
			} else if (!serverComplete) {
				// Server returned no messages and is not complete — protocol stalled
				if (import.meta.env.DEV)
					console.warn(
						`[sign] Round ${roundCount}: server returned no messages but not complete — retrying with empty`,
					);
				outgoing = [];
			} else {
				outgoing = [];
			}
		}

		// 5. Complete — server extracts signature and broadcasts
		const signResult = await api.post<SignResult>(`/signers/${signerId}/sign/complete`, {
			sessionId,
		});

		return signResult;
	} finally {
		// Destroy WASM session if created
		if (wasmSessionId) {
			try {
				const wasm = await ensureWasm();
				wasm.sign_destroy_session(wasmSessionId);
			} catch {
				// Best-effort cleanup
			}
		}
		// CRITICAL: Wipe share bytes and key material from memory
		userShareBytes.fill(0);
		keyMaterial.coreShare.fill(0);
		keyMaterial.auxInfo.fill(0);
	}
}
