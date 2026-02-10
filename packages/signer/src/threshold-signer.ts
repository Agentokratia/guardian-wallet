import type { IThresholdScheme, Share } from '@agentokratia/guardian-core';
import type { Message, SignSession } from '@silencelaboratories/dkls-wasm-ll-node';

import { HttpClient } from './http-client.js';
import type {
	CompleteMessageSignResponse,
	CompleteSignResponse,
	CreateMessageSignSessionResponse,
	CreateSignSessionResponse,
	ProcessSignRoundResponse,
} from './http-client.js';
import { loadShareFromFile, wipeShare } from './share-loader.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options accepted by the {@link ThresholdSigner.fromFile} factory. */
export interface FromFileOptions {
	/** Path to the encrypted `.enc` share file. */
	readonly sharePath: string;
	/** Passphrase used to decrypt the share file. */
	readonly passphrase: string;
	/** Base URL of the threshold signing server (e.g. `http://localhost:8080`). */
	readonly serverUrl: string;
	/** API key for authenticating with the server (`gw_live_*` / `gw_test_*`). */
	readonly apiKey: string;
	/** Threshold signing scheme implementation. Defaults to DKLs23. */
	readonly scheme?: IThresholdScheme;
	/** Optional HTTP timeout in milliseconds (default: 30 000). */
	readonly timeout?: number;
}

/** Options accepted by the {@link ThresholdSigner.fromSecret} factory. */
export interface FromSecretOptions {
	/** Base64-encoded keyshare data (the "API secret"). */
	readonly apiSecret: string;
	/** Base URL of the threshold signing server (e.g. `http://localhost:8080`). */
	readonly serverUrl: string;
	/** API key for authenticating with the server (`gw_live_*` / `gw_test_*`). */
	readonly apiKey: string;
	/** Threshold signing scheme implementation. Defaults to DKLs23. */
	readonly scheme?: IThresholdScheme;
	/** Optional HTTP timeout in milliseconds (default: 30 000). */
	readonly timeout?: number;
}

/** The result of an end-to-end transaction signing flow. */
export interface SignTransactionResult {
	readonly txHash: string;
	readonly signature: string;
}

/** The result of an end-to-end message signing flow. */
export interface SignMessageResult {
	readonly signature: string;
	readonly v: number;
	readonly r: string;
	readonly s: string;
}

/**
 * Minimal type representing the subset of a viem `Account` that we produce.
 * We avoid importing from `viem` at the type level so that the package
 * compiles even when viem is not installed.
 */
export interface ViemAccount {
	readonly address: `0x${string}`;
	readonly type: 'local';
	signMessage: (args: { message: unknown }) => Promise<`0x${string}`>;
	signTransaction: (tx: Record<string, unknown>) => Promise<`0x${string}`>;
	signTypedData: (typedData: unknown) => Promise<`0x${string}`>;
}

// ---------------------------------------------------------------------------
// WASM type helpers — lazily loaded to avoid hard dependency at import time
// ---------------------------------------------------------------------------

let wasmModule: typeof import('@silencelaboratories/dkls-wasm-ll-node') | null = null;

async function getWasm(): Promise<typeof import('@silencelaboratories/dkls-wasm-ll-node')> {
	if (wasmModule) return wasmModule;
	wasmModule = await import('@silencelaboratories/dkls-wasm-ll-node');
	return wasmModule;
}

let defaultScheme: IThresholdScheme | null = null;

async function getDefaultScheme(): Promise<IThresholdScheme> {
	if (defaultScheme) return defaultScheme;
	const { DKLs23Scheme } = await import('@agentokratia/guardian-schemes');
	defaultScheme = new DKLs23Scheme();
	return defaultScheme;
}

// ---------------------------------------------------------------------------
// ThresholdSigner
// ---------------------------------------------------------------------------

export class ThresholdSigner {
	private destroyed = false;

	/**
	 * @param share - The decrypted signer share.
	 * @param scheme - Threshold scheme implementation. Currently used only for
	 *   `deriveAddress()`. Retained in the constructor to avoid breaking the
	 *   public API; may be replaced by a standalone address derivation function
	 *   in a future version.
	 * @param httpClient - HTTP client for communicating with the signing server.
	 */
	constructor(
		private readonly share: Share,
		private readonly scheme: IThresholdScheme,
		private readonly httpClient: HttpClient,
	) {}

	// -----------------------------------------------------------------------
	// Factory
	// -----------------------------------------------------------------------

	/**
	 * Create a {@link ThresholdSigner} from an encrypted share file on disk.
	 *
	 * This is the recommended entry-point for most integrations:
	 *
	 * ```ts
	 * const signer = await ThresholdSigner.fromFile({
	 *   sharePath: './agent.share.enc',
	 *   passphrase: process.env.SHARE_PASSPHRASE!,
	 *   serverUrl: 'http://localhost:8080',
	 *   apiKey: 'gw_live_...',
	 * });
	 * ```
	 */
	static async fromFile(opts: FromFileOptions): Promise<ThresholdSigner> {
		const share = await loadShareFromFile(opts.sharePath, opts.passphrase);
		const scheme = opts.scheme ?? await getDefaultScheme();

		const httpClient = new HttpClient({
			baseUrl: opts.serverUrl,
			apiKey: opts.apiKey,
			timeout: opts.timeout,
		});

		return new ThresholdSigner(share, scheme, httpClient);
	}

	/**
	 * Create a {@link ThresholdSigner} from a base64-encoded keyshare secret.
	 *
	 * This is the simplest entry-point — just API key + API secret:
	 *
	 * ```ts
	 * const signer = await ThresholdSigner.fromSecret({
	 *   apiKey: 'gw_live_...',
	 *   apiSecret: '<base64 keyshare>',
	 *   serverUrl: 'http://localhost:8080',
	 * });
	 * ```
	 */
	static async fromSecret(opts: FromSecretOptions): Promise<ThresholdSigner> {
		const data = new Uint8Array(Buffer.from(opts.apiSecret, 'base64'));

		// Extract public key from the WASM keyshare
		let publicKey = new Uint8Array(0);
		try {
			const wasm = await getWasm();
			const ks = wasm.Keyshare.fromBytes(new Uint8Array(data));
			publicKey = new Uint8Array(ks.publicKey);
		} catch {
			// WASM not available — signing still works, address derivation won't
		}

		const share: Share = {
			data,
			participantIndex: 1,
			publicKey,
			scheme: 'dkls23' as Share['scheme'],
			curve: 'secp256k1' as Share['curve'],
		};

		const scheme = opts.scheme ?? await getDefaultScheme();

		const httpClient = new HttpClient({
			baseUrl: opts.serverUrl,
			apiKey: opts.apiKey,
			timeout: opts.timeout,
		});

		return new ThresholdSigner(share, scheme, httpClient);
	}

	// -----------------------------------------------------------------------
	// Signing -- end-to-end (interactive DKLs23 protocol)
	// -----------------------------------------------------------------------

	/**
	 * End-to-end transaction signing via the interactive DKLs23 protocol:
	 *
	 * 1. Create a local SignSession from the signer's Keyshare.
	 * 2. Exchange multi-round messages with the server until presigned.
	 * 3. Compute the message hash and send the last message.
	 * 4. Server combines, broadcasts, and returns `{ txHash, signature }`.
	 *
	 * THE FULL PRIVATE KEY NEVER EXISTS — only Message objects (round data)
	 * are exchanged. The Keyshare bytes never leave the signer.
	 */
	async signTransaction(tx: Record<string, unknown>): Promise<SignTransactionResult> {
		this.assertNotDestroyed();

		const wasm = await getWasm();
		const keyshare = wasm.Keyshare.fromBytes(this.share.data);
		const signerSession = new wasm.SignSession(keyshare, 'm');
		// Note: keyshare is consumed by SignSession constructor

		try {
			// 1. Create first message
			const firstMsg = signerSession.createFirstMessage();
			const firstMsgBytes = serializeMessage(firstMsg);
			firstMsg.free();

			// 2. POST /sign/session with first message + transaction
			const sessionResponse: CreateSignSessionResponse =
				await this.httpClient.createSignSession({
					signerFirstMessage: uint8ToBase64(firstMsgBytes),
					transaction: tx,
				});

			// 3. Run interactive rounds until presigned.
			//    The server auto-populates gas/nonce, so we use the server's
			//    messageHash (returned when presigned=true) to ensure both
			//    parties agree on the transaction hash.
			const { sessionId } = sessionResponse;
			const messageHash = await this.runSigningRounds(
				wasm,
				signerSession,
				sessionId,
				sessionResponse.serverFirstMessage,
				sessionResponse.initialMessages,
			);
			if (!messageHash) {
				throw new Error('Server did not return messageHash after presigning');
			}

			// 4. Create last message
			const lastMsg = signerSession.lastMessage(messageHash);
			const lastMsgBytes = serializeMessage(lastMsg);
			lastMsg.free();

			// 5. POST /sign/complete — server combines, broadcasts, returns txHash
			const completeResponse: CompleteSignResponse =
				await this.httpClient.completeSign({
					sessionId,
					lastMessage: uint8ToBase64(lastMsgBytes),
					messageHash: uint8ToBase64(messageHash),
				});

			const { r, s, v } = completeResponse.signature;
			return {
				txHash: completeResponse.txHash,
				signature: `0x${r.replace('0x', '')}${s.replace('0x', '')}${v.toString(16).padStart(2, '0')}`,
			};
		} finally {
			signerSession.free();
		}
	}

	/**
	 * End-to-end message signing via the interactive DKLs23 protocol
	 * (raw messages or EIP-712 typed data):
	 *
	 * Same multi-round exchange as `signTransaction()`, but the server
	 * returns a signature instead of broadcasting a transaction.
	 */
	async signMessage(message: unknown): Promise<SignMessageResult> {
		this.assertNotDestroyed();

		const wasm = await getWasm();
		const keyshare = wasm.Keyshare.fromBytes(this.share.data);
		const signerSession = new wasm.SignSession(keyshare, 'm');

		try {
			// 1. Create first message
			const firstMsg = signerSession.createFirstMessage();
			const firstMsgBytes = serializeMessage(firstMsg);
			firstMsg.free();

			// 2. POST /sign-message/session with first message + message data
			const sessionResponse: CreateMessageSignSessionResponse =
				await this.httpClient.createMessageSignSession({
					signerFirstMessage: uint8ToBase64(firstMsgBytes),
					message,
				});

			// 3. Run interactive rounds until presigned
			const { sessionId } = sessionResponse;
			await this.runSigningRounds(
				wasm,
				signerSession,
				sessionId,
				sessionResponse.serverFirstMessage,
				sessionResponse.initialMessages,
			);

			// 4. Hash the message locally — for message signing the client
			//    knows the message and can compute the hash deterministically.
			const viemModule = await import('viem');
			let hashHex: `0x${string}`;
			if (typeof message === 'string') {
				hashHex = viemModule.hashMessage(message);
			} else if (typeof message === 'object' && message !== null && 'domain' in (message as Record<string, unknown>)) {
				const typed = message as { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> };
				hashHex = viemModule.hashTypedData(typed as Parameters<typeof viemModule.hashTypedData>[0]);
			} else {
				hashHex = viemModule.hashMessage(JSON.stringify(message));
			}
			const messageHash = new Uint8Array(Buffer.from(hashHex.slice(2), 'hex'));

			// 5. Create last message
			const lastMsg = signerSession.lastMessage(messageHash);
			const lastMsgBytes = serializeMessage(lastMsg);
			lastMsg.free();

			// 6. POST /sign-message/complete — server combines, returns (v,r,s)
			const completeResponse: CompleteMessageSignResponse =
				await this.httpClient.completeMessageSign({
					sessionId,
					lastMessage: uint8ToBase64(lastMsgBytes),
					messageHash: uint8ToBase64(messageHash),
				});

			const { r, s, v } = completeResponse.signature;
			return {
				signature: `0x${r.replace('0x', '')}${s.replace('0x', '')}${v.toString(16).padStart(2, '0')}`,
				v,
				r,
				s,
			};
		} finally {
			signerSession.free();
		}
	}

	// -----------------------------------------------------------------------
	// viem integration
	// -----------------------------------------------------------------------

	/**
	 * Return a viem-compatible custom account object backed by this threshold
	 * signer.
	 *
	 * The returned object conforms to viem's `CustomAccount` shape and can be
	 * passed directly to `createWalletClient`:
	 *
	 * ```ts
	 * import { createWalletClient, http } from 'viem';
	 * import { sepolia } from 'viem/chains';
	 *
	 * const account = signer.toViemAccount();
	 * const client = createWalletClient({
	 *   account,
	 *   chain: sepolia,
	 *   transport: http(),
	 * });
	 * await client.sendTransaction({ to: '0x...', value: 1n });
	 * ```
	 *
	 * Note: viem is a **peer dependency**. Install it for full type support.
	 */
	toViemAccount(): ViemAccount {
		this.assertNotDestroyed();

		const self = this;

		return {
			address: this.address as `0x${string}`,
			type: 'local' as const,

			async signMessage({ message }: { message: unknown }) {
				const result = await self.signMessage(message);
				return result.signature as `0x${string}`;
			},

			async signTransaction(tx: Record<string, unknown>) {
				const result = await self.signTransaction(tx);
				return result.signature as `0x${string}`;
			},

			async signTypedData(typedData: unknown) {
				const result = await self.signMessage(typedData);
				return result.signature as `0x${string}`;
			},
		};
	}

	// -----------------------------------------------------------------------
	// Accessors
	// -----------------------------------------------------------------------

	/** Ethereum address derived from the shared public key. */
	get address(): string {
		return this.scheme.deriveAddress(this.share.publicKey);
	}

	/** The participant index of the loaded share (1, 2, or 3). */
	get participantIndex(): 1 | 2 | 3 {
		return this.share.participantIndex;
	}

	/** Whether this signer instance has been destroyed. */
	get isDestroyed(): boolean {
		return this.destroyed;
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	/**
	 * Wipe the share data from memory and mark this signer as destroyed.
	 * All subsequent signing calls will throw.
	 */
	destroy(): void {
		if (this.destroyed) return;
		wipeShare(this.share);
		this.destroyed = true;
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	private assertNotDestroyed(): void {
		if (this.destroyed) {
			throw new Error('ThresholdSigner has been destroyed. Share data has been wiped.');
		}
	}

	/**
	 * Run the interactive DKLs23 signing rounds between the local
	 * SignSession and the server, until the presignature is complete.
	 *
	 * The server processes the signer's broadcast in createSession and returns
	 * both its broadcast (serverFirstMessage) and its round 1 output
	 * (initialRoundMessages). The client processes both sequentially, producing
	 * two batches of outgoing messages that are sent together in the first
	 * processRound request.
	 */
	private async runSigningRounds(
		wasm: typeof import('@silencelaboratories/dkls-wasm-ll-node'),
		signerSession: SignSession,
		sessionId: string,
		serverFirstMessageB64: string,
		initialRoundMessagesB64?: string[],
	): Promise<Uint8Array | undefined> {
		// Process the server's broadcast (first message)
		const serverFirstMsg = deserializeMessage(wasm, base64ToUint8(serverFirstMessageB64));
		let outgoing = signerSession.handleMessages([serverFirstMsg]);
		freeMessages([serverFirstMsg]);

		// Process server's round 1 output (initialRoundMessages from createSession)
		if (initialRoundMessagesB64 && initialRoundMessagesB64.length > 0) {
			// Collect signerR1 output before processing server's round 1
			const signerR1 = outgoing;
			const serverR1Msgs = initialRoundMessagesB64.map((b64) =>
				deserializeMessage(wasm, base64ToUint8(b64)),
			);
			const signerR2 = signerSession.handleMessages(serverR1Msgs);
			freeMessages(serverR1Msgs);

			// Combine both batches: server needs signerR1 AND signerR2
			outgoing = [...signerR1, ...signerR2];
		}

		let presigned = false;
		let serverMessageHash: Uint8Array | undefined;

		while (!presigned) {
			// Serialize outgoing messages for the server
			const outgoingBase64 = outgoing.map((m) => {
				const bytes = serializeMessage(m);
				try { m.free(); } catch { /* already consumed */ }
				return uint8ToBase64(bytes);
			});

			const roundResponse: ProcessSignRoundResponse =
				await this.httpClient.processSignRound({
					sessionId,
					messages: outgoingBase64,
				});

			presigned = roundResponse.presigned;

			// Capture the server-computed messageHash when presigning completes
			if (roundResponse.messageHash) {
				serverMessageHash = base64ToUint8(roundResponse.messageHash);
			}

			if (roundResponse.messages.length > 0) {
				// Process each server message sequentially — the server may
				// return multiple rounds of output in a single response.
				const allOutgoing: Message[] = [];
				for (const b64 of roundResponse.messages) {
					const serverMsg = deserializeMessage(wasm, base64ToUint8(b64));
					const out = signerSession.handleMessages([serverMsg]);
					freeMessages([serverMsg]);
					allOutgoing.push(...out);
				}
				outgoing = allOutgoing;
			}

			// If presigned, the outgoing messages from this last handleMessages
			// are not sent — the protocol transitions to lastMessage() next.
			if (presigned) {
				outgoing.forEach((m) => { try { m.free(); } catch { /* already consumed */ } });
			}
		}

		return serverMessageHash;
	}
}

// ---------------------------------------------------------------------------
// Message serialization helpers
// ---------------------------------------------------------------------------

/**
 * Serialize a DKLs23 Message into a compact binary format.
 *
 * Layout: [from_id: u8][has_to: u8][to_id: u8][payload_len: u32 BE][payload]
 */
function serializeMessage(msg: Message): Uint8Array {
	const payload = msg.payload;
	const buf = new Uint8Array(7 + payload.length);
	buf[0] = msg.from_id;
	buf[1] = msg.to_id !== undefined ? 1 : 0;
	buf[2] = msg.to_id ?? 0;
	const view = new DataView(buf.buffer);
	view.setUint32(3, payload.length, false);
	buf.set(payload, 7);
	return buf;
}

/**
 * Deserialize a binary buffer back into a DKLs23 Message.
 *
 * Layout: [from_id: u8][has_to: u8][to_id: u8][payload_len: u32 BE][payload]
 */
const MSG_HEADER_SIZE = 7;

function deserializeMessage(
	wasm: typeof import('@silencelaboratories/dkls-wasm-ll-node'),
	bytes: Uint8Array,
): Message {
	if (bytes.length < MSG_HEADER_SIZE) {
		throw new Error(`Message too short: expected at least ${MSG_HEADER_SIZE} bytes, got ${bytes.length}`);
	}
	const from = bytes[0]!;
	const hasTo = bytes[1] === 1;
	const to = hasTo ? bytes[2] : undefined;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const payloadLen = view.getUint32(3, false);
	if (payloadLen > bytes.length - MSG_HEADER_SIZE) {
		throw new Error(
			`Message payload length ${payloadLen} exceeds available data (${bytes.length - MSG_HEADER_SIZE} bytes)`,
		);
	}
	const payload = bytes.slice(MSG_HEADER_SIZE, MSG_HEADER_SIZE + payloadLen);
	return new wasm.Message(payload, from, to);
}

function freeMessages(msgs: Message[]): void {
	for (const m of msgs) {
		try { m.free(); } catch { /* already consumed by handleMessages */ }
	}
}

function uint8ToBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64');
}

function base64ToUint8(b64: string): Uint8Array {
	return new Uint8Array(Buffer.from(b64, 'base64'));
}


