import type { IThresholdScheme, Share } from '@agentokratia/guardian-core';

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
	/** Threshold signing scheme implementation. Defaults to CGGMP24. */
	readonly scheme?: IThresholdScheme;
	/** Optional HTTP timeout in milliseconds (default: 30 000). */
	readonly timeout?: number;
}

/** Options accepted by the {@link ThresholdSigner.fromSecret} factory. */
export interface FromSecretOptions {
	/** Base64-encoded key material (the "API secret"). JSON: { coreShare, auxInfo } */
	readonly apiSecret: string;
	/** Base URL of the threshold signing server (e.g. `http://localhost:8080`). */
	readonly serverUrl: string;
	/** API key for authenticating with the server (`gw_live_*` / `gw_test_*`). */
	readonly apiKey: string;
	/** Threshold signing scheme implementation. Defaults to CGGMP24. */
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
// Default scheme — lazily loaded
// ---------------------------------------------------------------------------

let defaultScheme: IThresholdScheme | null = null;

async function getDefaultScheme(): Promise<IThresholdScheme> {
	if (defaultScheme) return defaultScheme;
	const { CGGMP24Scheme } = await import('@agentokratia/guardian-schemes');
	defaultScheme = new CGGMP24Scheme();
	return defaultScheme;
}

// ---------------------------------------------------------------------------
// ThresholdSigner
// ---------------------------------------------------------------------------

export class ThresholdSigner {
	private destroyed = false;

	/**
	 * @param share - The decrypted signer share (data = JSON key material).
	 * @param scheme - Threshold scheme implementation.
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
	 * Create a {@link ThresholdSigner} from a base64-encoded key material secret.
	 *
	 * The apiSecret is a base64-encoded JSON: { coreShare: base64, auxInfo: base64 }
	 */
	static async fromSecret(opts: FromSecretOptions): Promise<ThresholdSigner> {
		const data = new Uint8Array(Buffer.from(opts.apiSecret, 'base64'));
		const scheme = opts.scheme ?? await getDefaultScheme();

		// Initialize WASM if the scheme supports it (needed for signing + key extraction)
		if ('initWasm' in scheme && typeof (scheme as Record<string, unknown>).initWasm === 'function') {
			await (scheme as { initWasm: () => Promise<void> }).initWasm();
		}

		// Try to extract public key from the key material
		let publicKey = new Uint8Array(0);
		try {
			const keyMaterial = parseKeyMaterial(data);
			const extracted = scheme.extractPublicKey?.(keyMaterial.coreShare);
			publicKey = extracted ? new Uint8Array(extracted) : new Uint8Array(0);
		} catch {
			// Key extraction failed — signing still works, address derivation won't
		}

		const share: Share = {
			data,
			participantIndex: 1,
			publicKey,
			scheme: 'cggmp24' as Share['scheme'],
			curve: 'secp256k1' as Share['curve'],
		};

		const httpClient = new HttpClient({
			baseUrl: opts.serverUrl,
			apiKey: opts.apiKey,
			timeout: opts.timeout,
		});

		return new ThresholdSigner(share, scheme, httpClient);
	}

	// -----------------------------------------------------------------------
	// Signing -- end-to-end (interactive CGGMP24 protocol)
	// -----------------------------------------------------------------------

	/**
	 * End-to-end transaction signing via the interactive CGGMP24 protocol:
	 *
	 * 1. Send transaction to server (no first message — server computes hash).
	 * 2. Receive messageHash, eid, partyConfig, serverFirstMessages from server.
	 * 3. Create local sign session with the correct hash + party config.
	 * 4. Process server's first messages, exchange rounds until complete.
	 * 5. Server extracts signature, broadcasts, returns `{ txHash, signature }`.
	 *
	 * THE FULL PRIVATE KEY NEVER EXISTS — only protocol messages are exchanged.
	 */
	async signTransaction(tx: Record<string, unknown>): Promise<SignTransactionResult> {
		this.assertNotDestroyed();

		// Parse key material
		const keyMaterial = parseKeyMaterial(this.share.data);

		try {
			// 1. POST /sign/session with transaction only (no first message)
			const sessionResponse: CreateSignSessionResponse =
				await this.httpClient.createSignSession({
					transaction: tx,
				});

			const { sessionId } = sessionResponse;

			// 2. Create local sign session with the correct hash from server
			const messageHash = base64ToUint8(sessionResponse.messageHash);
			const eid = base64ToUint8(sessionResponse.eid);
			const { clientPartyIndex, partiesAtKeygen } = sessionResponse.partyConfig;

			const { sessionId: schemeSessionId, firstMessages } =
				await this.scheme.createSignSession(
					[keyMaterial.coreShare, keyMaterial.auxInfo],
					messageHash,
					{ partyIndex: clientPartyIndex, partiesAtKeygen, eid },
				);

			// 3. Process server's first messages to get our response
			const serverFirstMsgs = sessionResponse.serverFirstMessages.map(base64ToUint8);
			let result = await this.scheme.processSignRound(schemeSessionId, serverFirstMsgs);
			let outgoing = [...firstMessages, ...result.outgoingMessages];

			// 4. Exchange rounds until server reports complete (max 20 round-trips as safety guard)
			const MAX_ROUNDS = 20;
			let serverComplete = result.complete;
			let roundCount = 0;
			while (!serverComplete) {
				if (++roundCount > MAX_ROUNDS) {
					throw new Error(`Signing protocol did not complete after ${MAX_ROUNDS} rounds`);
				}
				const outgoingBase64 = outgoing.map(uint8ToBase64);

				const roundResponse: ProcessSignRoundResponse =
					await this.httpClient.processSignRound({
						sessionId,
						messages: outgoingBase64,
					});

				serverComplete = roundResponse.complete;

				if (roundResponse.messages.length > 0 && !serverComplete) {
					const serverMsgs = roundResponse.messages.map(base64ToUint8);
					const roundResult = await this.scheme.processSignRound(schemeSessionId, serverMsgs);
					outgoing = roundResult.outgoingMessages;
					// Client may complete before server — keep sending messages
				} else {
					outgoing = [];
				}
			}

			// 5. POST /sign/complete — server extracts signature, broadcasts, returns txHash
			const completeResponse: CompleteSignResponse =
				await this.httpClient.completeSign({ sessionId });

			const { r, s, v } = completeResponse.signature;
			return {
				txHash: completeResponse.txHash,
				signature: `0x${r.replace('0x', '')}${s.replace('0x', '')}${v.toString(16).padStart(2, '0')}`,
			};
		} finally {
			wipeKeyMaterial(keyMaterial);
		}
	}

	/**
	 * End-to-end message signing via the interactive CGGMP24 protocol.
	 *
	 * Same 2-step flow as transaction signing:
	 * 1. Send hash + message to server (no first message — server generates EID)
	 * 2. Receive eid, partyConfig, serverFirstMessages
	 * 3. Create local session with correct eid + partyConfig
	 * 4. Process server's first messages, exchange rounds until complete
	 * 5. Server extracts signature
	 *
	 * Both parties MUST use the same EID — sending a first message with a
	 * different EID would cause a protocol failure.
	 */
	async signMessage(message: unknown): Promise<SignMessageResult> {
		this.assertNotDestroyed();

		const keyMaterial = parseKeyMaterial(this.share.data);

		try {
			// Hash the message locally
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

			// 1. POST /sign-message/session with hash only (no first message)
			//    Server generates EID and creates its session first.
			const sessionResponse: CreateMessageSignSessionResponse =
				await this.httpClient.createMessageSignSession({
					messageHash: uint8ToBase64(messageHash),
					message,
				});

			const { sessionId } = sessionResponse;

			// 2. Create local session with server's EID and party config
			const eid = base64ToUint8(sessionResponse.eid);
			const { clientPartyIndex, partiesAtKeygen } = sessionResponse.partyConfig;

			const { sessionId: schemeSessionId, firstMessages } =
				await this.scheme.createSignSession(
					[keyMaterial.coreShare, keyMaterial.auxInfo],
					messageHash,
					{ partyIndex: clientPartyIndex, partiesAtKeygen, eid },
				);

			// 3. Process server's first messages to get our response
			const serverFirstMsgs = sessionResponse.serverFirstMessages.map(base64ToUint8);
			let result = await this.scheme.processSignRound(schemeSessionId, serverFirstMsgs);
			let outgoing = [...firstMessages, ...result.outgoingMessages];

			// 4. Exchange rounds until server reports complete (max 20 round-trips as safety guard)
			const MAX_MSG_ROUNDS = 20;
			let serverComplete = result.complete;
			let roundCount = 0;
			while (!serverComplete) {
				if (++roundCount > MAX_MSG_ROUNDS) {
					throw new Error(`Signing protocol did not complete after ${MAX_MSG_ROUNDS} rounds`);
				}
				const outgoingBase64 = outgoing.map(uint8ToBase64);

				const roundResponse: ProcessSignRoundResponse =
					await this.httpClient.processSignRound({
						sessionId,
						messages: outgoingBase64,
					});

				serverComplete = roundResponse.complete;

				if (roundResponse.messages.length > 0 && !serverComplete) {
					const serverMsgs = roundResponse.messages.map(base64ToUint8);
					const roundResult = await this.scheme.processSignRound(schemeSessionId, serverMsgs);
					outgoing = roundResult.outgoingMessages;
					// Client may complete before server — keep sending messages
				} else {
					outgoing = [];
				}
			}

			// 5. POST /sign-message/complete — server extracts signature
			const completeResponse: CompleteMessageSignResponse =
				await this.httpClient.completeMessageSign({ sessionId });

			const { r, s, v } = completeResponse.signature;
			return {
				signature: `0x${r.replace('0x', '')}${s.replace('0x', '')}${v.toString(16).padStart(2, '0')}`,
				v,
				r,
				s,
			};
		} finally {
			wipeKeyMaterial(keyMaterial);
		}
	}

	// -----------------------------------------------------------------------
	// viem integration
	// -----------------------------------------------------------------------

	/**
	 * Return a viem-compatible custom account object backed by this threshold signer.
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
				// Server already broadcasts and returns txHash.
				// Return txHash; callers should use signTransaction() directly.
				return result.txHash as `0x${string}`;
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

	// Round exchange logic is inline in signTransaction() and signMessage()
	// to allow each path to handle its specific session creation flow.
}

// ---------------------------------------------------------------------------
// Key material helpers
// ---------------------------------------------------------------------------

interface ParsedKeyMaterial {
	coreShare: Uint8Array;
	auxInfo: Uint8Array;
}

function parseKeyMaterial(data: Uint8Array): ParsedKeyMaterial {
	const json = new TextDecoder().decode(data);
	const parsed = JSON.parse(json) as { coreShare: string; auxInfo: string };
	return {
		coreShare: new Uint8Array(Buffer.from(parsed.coreShare, 'base64')),
		auxInfo: new Uint8Array(Buffer.from(parsed.auxInfo, 'base64')),
	};
}

function wipeKeyMaterial(km: ParsedKeyMaterial): void {
	km.coreShare.fill(0);
	km.auxInfo.fill(0);
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

function uint8ToBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64');
}

function base64ToUint8(b64: string): Uint8Array {
	return new Uint8Array(Buffer.from(b64, 'base64'));
}
