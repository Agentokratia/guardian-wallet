/**
 * CGGMP24 threshold ECDSA scheme backed by the guardian-mpc-wasm Rust WASM module.
 *
 * - Two-phase DKG: auxInfoGen (Paillier primes) + keygen (shares) — run as single WASM call
 * - Signing requires messageHash upfront
 * - Protocol produces signature when complete (no separate finalize step)
 * - Key material is split: CoreKeyShare + AuxInfo
 * - State machine API: safe to serialize between rounds
 *
 * THE FULL PRIVATE KEY NEVER EXISTS — signing is a distributed computation.
 */

import { secp256k1 } from '@noble/curves/secp256k1.js';
import type {
	AuxInfoRoundResult,
	DKGRoundResult,
	IThresholdScheme,
} from '@agentokratia/guardian-core';
import type { CurveName } from '@agentokratia/guardian-core';
import type { SchemeName } from '@agentokratia/guardian-core';
import { getAddress, keccak256, toHex } from 'viem';

// Node.js-only imports — lazily loaded so the browser can use signing methods
// without pulling in node:child_process or node:fs.
// @vite-ignore comments prevent Vite/Rollup from bundling these for the browser.
let _execFile: typeof import('node:child_process').execFile | undefined;
async function getExecFile() {
	if (!_execFile) {
		const mod = await import(/* @vite-ignore */ 'node:child_process');
		_execFile = mod.execFile;
	}
	return _execFile;
}
let _spawn: typeof import('node:child_process').spawn | undefined;
async function getSpawn() {
	if (!_spawn) {
		const mod = await import(/* @vite-ignore */ 'node:child_process');
		_spawn = mod.spawn;
	}
	return _spawn;
}
let _createReadlineInterface: typeof import('node:readline').createInterface | undefined;
async function getReadlineInterface() {
	if (!_createReadlineInterface) {
		const mod = await import(/* @vite-ignore */ 'node:readline');
		_createReadlineInterface = mod.createInterface;
	}
	return _createReadlineInterface;
}
let _existsSync: typeof import('node:fs').existsSync | undefined;
async function getExistsSyncAsync(): Promise<typeof import('node:fs').existsSync | null> {
	if (_existsSync !== undefined) return _existsSync;
	try {
		const fs = await import(/* @vite-ignore */ 'node:fs');
		_existsSync = fs.existsSync;
		return _existsSync;
	} catch {
		return null;
	}
}
// Synchronous version for non-async contexts — only works if already loaded
function getExistsSync(): typeof import('node:fs').existsSync | null {
	return _existsSync ?? null;
}

// ---------------------------------------------------------------------------
// WASM module — lazily loaded
// ---------------------------------------------------------------------------

type WasmModule = typeof import('@agentokratia/guardian-mpc-wasm');

let wasmModule: WasmModule | null = null;

async function getWasm(): Promise<WasmModule> {
	if (wasmModule) return wasmModule;
	const mod = await import('@agentokratia/guardian-mpc-wasm');
	// The web build (pkg-web) exports a default init function that must be
	// called to fetch + instantiate the .wasm file. The Node.js build (pkg)
	// auto-initializes via readFileSync, so its default export is undefined.
	if (typeof mod.default === 'function') {
		await (mod.default as unknown as () => Promise<void>)();
	}
	wasmModule = mod;
	return wasmModule;
}

// ---------------------------------------------------------------------------
// Types for WASM DKG result
// ---------------------------------------------------------------------------

/** Typed DKG result returned by runDkg() */
export interface DkgResult {
	shares: Array<{ coreShare: Uint8Array; auxInfo: Uint8Array }>;
	publicKey: Uint8Array;
}

/** JSON output from the native `guardian-gen-primes dkg` binary */
interface NativeDkgOutput {
	shares: Array<{ core_share: string; aux_info: string }>; // base64
	public_key: string; // hex
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateEid(): Uint8Array {
	const eid = new Uint8Array(32);
	crypto.getRandomValues(eid);
	return eid;
}

// ---------------------------------------------------------------------------
// Types for WASM signing
// ---------------------------------------------------------------------------

/** Shape of a single protocol message crossing the WASM boundary */
interface WasmSignMessage {
	sender: number;
	is_broadcast: boolean;
	recipient: number | null;
	payload: string; // base64-encoded serde_json of Msg<Secp256k1, Sha256>
}

/** Result from wasm.sign_create_session() */
interface WasmCreateSessionResult {
	session_id: string;
	messages: WasmSignMessage[];
}

/** Result from wasm.sign_process_round() */
interface WasmProcessRoundResult {
	messages: WasmSignMessage[];
	complete: boolean;
	signature?: { r: number[]; s: number[] };
}

// ---------------------------------------------------------------------------
// Session state types (for interactive signing)
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 120_000;

interface SignSessionState {
	/** WASM-side session ID (inside the Rust thread_local) — present for WASM sessions */
	wasmSessionId?: string;
	/** Native child process — present for native GMP sessions */
	nativeProcess?: NativeSignProcess;
	messageHash: Uint8Array;
	publicKey: Uint8Array;
	complete: boolean;
	/** Stored signature when complete */
	signature?: { r: Uint8Array; s: Uint8Array };
	createdAt: number;
}

// ---------------------------------------------------------------------------
// NativeSignProcess — manages a child process for one signing session
// ---------------------------------------------------------------------------

/** JSON output from the native `sign` command */
interface NativeSignOutput {
	messages: WasmSignMessage[];
	complete: boolean;
	r?: string; // hex, 32 bytes
	s?: string; // hex, 32 bytes
}

/**
 * Manages a single native GMP-accelerated signing session.
 *
 * One child process per session — communicates via line-delimited JSON
 * on stdin/stdout. Wire-compatible with WASM (same WasmSignMessage format).
 */
class NativeSignProcess {
	private process: import('node:child_process').ChildProcess;
	private lineIterator: AsyncIterator<string>;
	signature?: { r: Uint8Array; s: Uint8Array };

	private constructor(
		process: import('node:child_process').ChildProcess,
		lineIterator: AsyncIterator<string>,
	) {
		this.process = process;
		this.lineIterator = lineIterator;
	}

	/** Read one JSON line from the child's stdout. */
	private async readLine(): Promise<string> {
		const { value, done } = await this.lineIterator.next();
		if (done) throw new Error('Native signing process ended unexpectedly');
		return value as string;
	}

	/**
	 * Spawn a native signing process and get first messages.
	 *
	 * @returns The process handle and first protocol messages.
	 */
	static async create(
		binaryPath: string,
		coreShare: Uint8Array,
		auxInfo: Uint8Array,
		messageHash: Uint8Array,
		partyIndex: number,
		partiesAtKeygen: number[],
		eid: Uint8Array,
	): Promise<{ nativeProcess: NativeSignProcess; firstMessages: WasmSignMessage[] }> {
		const spawnFn = await getSpawn();
		const createInterface = await getReadlineInterface();

		const child = spawnFn(binaryPath, ['sign'], {
			stdio: ['pipe', 'pipe', 'inherit'],
		});

		// Create async line iterator on stdout
		const rl = createInterface({ input: child.stdout! });
		const lineIterator = (rl as unknown as AsyncIterable<string>)[Symbol.asyncIterator]();

		const nativeProcess = new NativeSignProcess(child, lineIterator);

		// Build init payload
		const b64Encode = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
		const hexEncode = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

		const initPayload = JSON.stringify({
			core_share: b64Encode(coreShare),
			aux_info: b64Encode(auxInfo),
			message_hash: hexEncode(messageHash),
			party_index: partyIndex,
			parties_at_keygen: partiesAtKeygen,
			eid: hexEncode(eid),
		});

		// Write init line to stdin
		child.stdin!.write(initPayload + '\n');

		// Read first response
		const responseLine = await nativeProcess.readLine();
		const response = JSON.parse(responseLine) as NativeSignOutput;

		return { nativeProcess, firstMessages: response.messages };
	}

	/**
	 * Process one round: send incoming messages, receive response.
	 */
	async processRound(incoming: WasmSignMessage[]): Promise<{
		messages: WasmSignMessage[];
		complete: boolean;
	}> {
		// Write incoming messages to stdin
		this.process.stdin!.write(JSON.stringify(incoming) + '\n');

		// Read response
		const line = await this.readLine();
		const response = JSON.parse(line) as NativeSignOutput;

		if (response.complete && response.r && response.s) {
			this.signature = {
				r: new Uint8Array(Buffer.from(response.r, 'hex')),
				s: new Uint8Array(Buffer.from(response.s, 'hex')),
			};
		}

		return { messages: response.messages, complete: response.complete };
	}

	/** Kill the child process. */
	destroy(): void {
		try {
			this.process.kill();
		} catch {
			// Best-effort cleanup
		}
	}
}

// ---------------------------------------------------------------------------
// CGGMP24Scheme
// ---------------------------------------------------------------------------

/**
 * CGGMP24 threshold ECDSA scheme.
 *
 * Wraps the guardian-mpc-wasm Rust WASM module for all cryptographic
 * operations. When the native GMP binary is available, signing is routed
 * through it for ~10x faster Paillier operations. Falls back to WASM
 * automatically (browser, or when binary is not built).
 *
 * Key material format:
 * - coreShare = serialised CoreKeyShare (from keygen)
 * - auxInfo = serialised AuxInfo (from aux_info_gen)
 *
 * Both are JSON-serialised by the WASM module and can be stored/loaded
 * as opaque Uint8Array blobs.
 */
export class CGGMP24Scheme implements IThresholdScheme {
	readonly name: SchemeName = 'cggmp24' as SchemeName;
	readonly curve: CurveName = 'secp256k1' as CurveName;

	private readonly signSessions = new Map<string, SignSessionState>();

	/** undefined = not checked yet, string = path, null = not available */
	private _nativeBinPath: string | null | undefined = undefined;

	/** Check if the native GMP signing binary is available (async for ESM compat). */
	private async nativeBinaryAvailable(): Promise<boolean> {
		if (this._nativeBinPath === undefined) {
			const existsSyncFn = await getExistsSyncAsync();
			if (!existsSyncFn) {
				// Browser environment — no fs access
				this._nativeBinPath = null;
			} else {
				try {
					const { dirname, join, resolve } = await import(/* @vite-ignore */ 'node:path');
					const { fileURLToPath } = await import(/* @vite-ignore */ 'node:url');
					const thisDir = dirname(fileURLToPath(import.meta.url));
					let found = false;
					for (const candidate of [
						resolve(thisDir, '..', '..', '..', 'mpc-wasm'),
						resolve(thisDir, '..', '..', '..', '..', 'mpc-wasm'),
						resolve(thisDir, '..', '..', '..', '..', 'packages', 'mpc-wasm'),
					]) {
						const binPath = join(candidate, 'native-gen', 'target', 'release', 'guardian-gen-primes');
						if (existsSyncFn(binPath)) {
							this._nativeBinPath = binPath;
							found = true;
							break;
						}
					}
					if (!found) {
						this._nativeBinPath = null;
					}
				} catch {
					this._nativeBinPath = null;
				}
			}
		}
		return this._nativeBinPath !== null;
	}

	// ---- Session cleanup ----

	private cleanupExpiredSessions(): void {
		const now = Date.now();
		for (const [id, state] of this.signSessions) {
			if (now - state.createdAt > SESSION_TTL_MS) {
				// Destroy the backend session
				if (state.nativeProcess) {
					state.nativeProcess.destroy();
				} else if (wasmModule && state.wasmSessionId) {
					try {
						wasmModule.sign_destroy_session(state.wasmSessionId);
					} catch {
						// Best-effort cleanup
					}
				}
				this.signSessions.delete(id);
			}
		}
	}

	// ---- Full DKG (native binary — GMP accelerated) ----

	/**
	 * Run a DKG ceremony via native binary:
	 *
	 * 1. **Pool AuxInfo** → keygen only → **~1s** (Phase A pre-computed by AuxInfo pool)
	 * 2. **Cold start** → full DKG → **~180s** (everything computed inline)
	 */
	async runDkg(
		n: number = 3,
		threshold: number = 2,
		options?: { cachedAuxInfo?: string },
	): Promise<DkgResult> {
		const execFileFn = await getExecFile();
		const nativeBinary = await this.resolveNativeBinaryPath();
		if (!nativeBinary) {
			throw new Error('Native DKG binary not found — cannot run DKG');
		}

		const eidBytes = new Uint8Array(32);
		crypto.getRandomValues(eidBytes);
		const eidHex = Buffer.from(eidBytes).toString('hex');

		// Fast path: externally supplied AuxInfo (from server pool)
		if (options?.cachedAuxInfo) {
			console.log('[DKG] Using pool AuxInfo — keygen only (~1s)');
			return this.runNativeDkg(
				execFileFn, nativeBinary,
				'dkg-with-aux', n, threshold, eidHex,
				options.cachedAuxInfo,
			);
		}

		// Cold start — full DKG (~180s)
		console.log('[DKG] No pool AuxInfo — cold start (generating primes + aux_info inline)');
		return this.runNativeDkg(
			execFileFn, nativeBinary,
			'dkg', n, threshold, eidHex,
			null,
		);
	}

	/** Resolve path to the native DKG binary. */
	private async resolveNativeBinaryPath(): Promise<string | null> {
		const existsSyncFn = await getExistsSyncAsync();
		if (!existsSyncFn) return null;
		try {
			const { dirname, join, resolve } = await import(/* @vite-ignore */ 'node:path');
			const { fileURLToPath } = await import(/* @vite-ignore */ 'node:url');
			const thisDir = dirname(fileURLToPath(import.meta.url));
			for (const candidate of [
				resolve(thisDir, '..', '..', '..', 'mpc-wasm'),
				resolve(thisDir, '..', '..', '..', '..', 'mpc-wasm'),
				resolve(thisDir, '..', '..', '..', '..', 'packages', 'mpc-wasm'),
			]) {
				const binPath = join(candidate, 'native-gen', 'target', 'release', 'guardian-gen-primes');
				if (existsSyncFn(binPath)) return binPath;
			}
		} catch {
			// No native binary available
		}
		return null;
	}

	private async runNativeDkg(
		execFileFn: typeof import('node:child_process').execFile,
		nativeBinary: string,
		mode: string,
		n: number,
		threshold: number,
		eidHex: string,
		stdinData: string | null,
	): Promise<DkgResult> {
		const result = await new Promise<NativeDkgOutput>((resolve, reject) => {
			const child = execFileFn(
				nativeBinary,
				[mode, String(n), String(threshold), eidHex],
				{ maxBuffer: 50 * 1024 * 1024, timeout: 600_000 },
				(err, stdout, stderr) => {
					if (stderr) {
						for (const line of stderr.split('\n').filter((l) => l.trim())) {
							console.log(`[DKG-native] ${line}`);
						}
					}
					if (err) {
						reject(new Error(`Native DKG failed: ${err.message}`));
						return;
					}
					try {
						const parsed = JSON.parse(stdout.trim()) as NativeDkgOutput;
						resolve(parsed);
					} catch (e) {
						reject(new Error(`Failed to parse DKG output: ${String(e)}`));
					}
				},
			);

			if (stdinData && child.stdin) {
				child.stdin.write(stdinData);
				child.stdin.end();
			}
		});

		const publicKey = new Uint8Array(Buffer.from(result.public_key, 'hex'));

		return {
			shares: result.shares.map((s) => ({
				coreShare: new Uint8Array(Buffer.from(s.core_share, 'base64')),
				auxInfo: new Uint8Array(Buffer.from(s.aux_info, 'base64')),
			})),
			publicKey,
		};
	}

	/**
	 * Initialize the WASM module for signing operations.
	 * DKG uses the native binary, but signing still needs WASM.
	 * Call this on server startup.
	 */
	async initWasm(): Promise<void> {
		await getWasm();
	}

	// ---- IThresholdScheme: auxInfoGen / dkg (delegated to runDkg) ----
	// These round-by-round methods exist for interface compliance.
	// The DKG service should use runDkg() directly instead.

	async auxInfoGen(
		_sessionId: string,
		_round: number,
		_incoming: Uint8Array[],
	): Promise<AuxInfoRoundResult> {
		throw new Error(
			'auxInfoGen rounds are not used — call runDkg() for single-call DKG',
		);
	}

	async dkg(
		_sessionId: string,
		_round: number,
		_incoming: Uint8Array[],
	): Promise<DKGRoundResult> {
		throw new Error(
			'dkg rounds are not used — call runDkg() for single-call DKG',
		);
	}

	// ---- Address derivation ----

	deriveAddress(publicKey: Uint8Array): string {
		let uncompressedNoPrefix: Uint8Array;

		if (publicKey.length === 33) {
			const point = secp256k1.Point.fromBytes(publicKey);
			const uncompressed = point.toBytes(false); // 65 bytes: 0x04 + x + y
			uncompressedNoPrefix = uncompressed.slice(1);
		} else if (publicKey.length === 65) {
			uncompressedNoPrefix = publicKey.slice(1);
		} else {
			throw new Error(
				`Invalid public key length: ${String(publicKey.length)}. Expected 33 or 65.`,
			);
		}

		const hash = keccak256(toHex(uncompressedNoPrefix));
		const addressHex = `0x${hash.slice(-40)}` as `0x${string}`;
		return getAddress(addressHex);
	}

	/** Extract public key from serialised key share via WASM. */
	extractPublicKey(keyShareBytes: Uint8Array): Uint8Array {
		// Synchronous — WASM module handles deserialization
		// This will be called after WASM is loaded
		if (!wasmModule) {
			throw new Error('WASM module not yet loaded — call runDkg() first');
		}
		return new Uint8Array(wasmModule.extract_public_key(keyShareBytes));
	}

	// ---- Interactive signing (hash required upfront) ----

	async createSignSession(
		keyMaterialBytes: Uint8Array[],
		messageHash: Uint8Array,
		options?: {
			partyIndex?: number;
			partiesAtKeygen?: number[];
			eid?: Uint8Array;
			/** Force WASM backend (skip native GMP). Required when the other
			 *  signing party also uses WASM (e.g. browser User+Server path)
			 *  to avoid cross-backend protocol incompatibilities. */
			forceWasm?: boolean;
		},
	): Promise<{
		sessionId: string;
		firstMessages: Uint8Array[];
	}> {
		this.cleanupExpiredSessions();

		if (keyMaterialBytes.length < 2) {
			throw new Error(
				`Need [coreShare, auxInfo] — got ${String(keyMaterialBytes.length)} items`,
			);
		}
		if (messageHash.length !== 32) {
			throw new Error(
				`messageHash must be 32 bytes, got ${String(messageHash.length)}`,
			);
		}

		const coreShare = keyMaterialBytes[0]!;
		const auxInfo = keyMaterialBytes[1]!;

		const partyIndex = options?.partyIndex ?? 0;
		const partiesAtKeygen = options?.partiesAtKeygen ?? [0, 1];
		const eid = options?.eid ?? generateEid();

		// Extract public key from the core share for recovery ID computation
		let publicKey = new Uint8Array(33);
		if (wasmModule) {
			try {
				publicKey = new Uint8Array(
					wasmModule.extract_public_key(coreShare),
				);
			} catch {
				// Will fail for recovery ID if not available
			}
		}

		// Try native GMP path (Node.js only — ~10x faster than WASM)
		// Skip native when forceWasm is set (cross-backend protocol messages
		// are incompatible between rug/GMP and num-bigint backends).
		if (!options?.forceWasm && await this.nativeBinaryAvailable()) {
			const { nativeProcess, firstMessages: nativeMsgs } =
				await NativeSignProcess.create(
					this._nativeBinPath!,
					coreShare,
					auxInfo,
					messageHash,
					partyIndex,
					partiesAtKeygen,
					eid,
				);

			const sessionId = crypto.randomUUID();
			this.signSessions.set(sessionId, {
				nativeProcess,
				messageHash: new Uint8Array(messageHash),
				publicKey,
				complete: false,
				createdAt: Date.now(),
			});

			// Serialize native messages to Uint8Array[] for the caller
			const firstMessages = nativeMsgs.map((msg) =>
				new TextEncoder().encode(JSON.stringify(msg)),
			);

			return { sessionId, firstMessages };
		}

		// WASM fallback
		if (!wasmModule) {
			throw new Error(
				'WASM module not yet loaded — call runDkg() or ensure WASM is initialized first',
			);
		}

		// Call WASM to create the signing state machine and get first messages
		const wasmResult = wasmModule.sign_create_session(
			coreShare,
			auxInfo,
			messageHash,
			partyIndex,
			new Uint16Array(partiesAtKeygen),
			eid,
		) as WasmCreateSessionResult;

		// Generate a TS-side session ID (maps to the WASM-side session)
		const sessionId = crypto.randomUUID();

		this.signSessions.set(sessionId, {
			wasmSessionId: wasmResult.session_id,
			messageHash: new Uint8Array(messageHash),
			publicKey,
			complete: false,
			createdAt: Date.now(),
		});

		// Serialize WASM messages to Uint8Array[] for the caller
		const firstMessages = wasmResult.messages.map((msg) =>
			new TextEncoder().encode(JSON.stringify(msg)),
		);

		return { sessionId, firstMessages };
	}

	async processSignRound(
		sessionId: string,
		incomingMessages: Uint8Array[],
	): Promise<{
		outgoingMessages: Uint8Array[];
		complete: boolean;
	}> {
		const state = this.signSessions.get(sessionId);
		if (!state) {
			throw new Error(`No sign session found for id: ${sessionId}`);
		}

		// Deserialize incoming messages from Uint8Array[] to WasmSignMessage[]
		const incoming: WasmSignMessage[] = incomingMessages.map((bytes) => {
			const json = new TextDecoder().decode(bytes);
			return JSON.parse(json) as WasmSignMessage;
		});

		// Native GMP path
		if (state.nativeProcess) {
			const result = await state.nativeProcess.processRound(incoming);

			if (result.complete && state.nativeProcess.signature) {
				state.complete = true;
				state.signature = state.nativeProcess.signature;
			}

			const outgoingMessages = result.messages.map((msg) =>
				new TextEncoder().encode(JSON.stringify(msg)),
			);

			return { outgoingMessages, complete: result.complete };
		}

		// WASM fallback
		if (!wasmModule) {
			throw new Error('WASM module not yet loaded');
		}

		// Call WASM to process the round
		const wasmResult = wasmModule.sign_process_round(
			state.wasmSessionId!,
			incoming,
		) as WasmProcessRoundResult;

		if (wasmResult.complete && wasmResult.signature) {
			state.complete = true;
			state.signature = {
				r: new Uint8Array(wasmResult.signature.r),
				s: new Uint8Array(wasmResult.signature.s),
			};
		}

		// Serialize outgoing messages
		const outgoingMessages = wasmResult.messages.map((msg) =>
			new TextEncoder().encode(JSON.stringify(msg)),
		);

		return { outgoingMessages, complete: wasmResult.complete };
	}

	async finalizeSign(sessionId: string): Promise<{
		r: Uint8Array;
		s: Uint8Array;
		v: number;
	}> {
		const state = this.signSessions.get(sessionId);
		if (!state) {
			throw new Error(`No sign session found for id: ${sessionId}`);
		}
		if (!state.complete || !state.signature) {
			throw new Error(
				'Sign session not yet complete. Run all rounds first.',
			);
		}

		try {
			const { r, s } = state.signature;
			const v = this.computeRecoveryId(
				r,
				s,
				state.messageHash,
				state.publicKey,
			);

			return { r, s, v };
		} finally {
			// Destroy the backend session
			if (state.nativeProcess) {
				state.nativeProcess.destroy();
			} else if (wasmModule && state.wasmSessionId) {
				try {
					wasmModule.sign_destroy_session(state.wasmSessionId);
				} catch {
					// Best-effort cleanup
				}
			}
			this.signSessions.delete(sessionId);
		}
	}

	// ---- Presignature support (stubs — to be implemented) ----

	createPresignSession(
		_keyMaterialBytes: Uint8Array[],
	): {
		sessionId: string;
		firstMessages: Uint8Array[];
	} {
		throw new Error('Presignature support not yet implemented');
	}

	processPresignRound(
		_sessionId: string,
		_incomingMessages: Uint8Array[],
	): {
		outgoingMessages: Uint8Array[];
		complete: boolean;
	} {
		throw new Error('Presignature support not yet implemented');
	}

	extractPresignature(_sessionId: string): {
		presignature: Uint8Array;
		commitment: Uint8Array;
	} {
		throw new Error('Presignature support not yet implemented');
	}

	issuePartialSignature(
		_presignature: Uint8Array,
		_messageHash: Uint8Array,
	): Uint8Array {
		throw new Error('Presignature support not yet implemented');
	}

	combinePartialSignatures(
		_partials: Uint8Array[],
		_commitment: Uint8Array,
		_messageHash: Uint8Array,
	): {
		r: Uint8Array;
		s: Uint8Array;
		v: number;
	} {
		throw new Error('Presignature support not yet implemented');
	}

	// ---- Internal helpers ----

	/**
	 * Compute the Ethereum signature recovery ID (v = 27 or 28).
	 * Tries both recovery bits and matches the recovered public key
	 * against the expected DKG public key.
	 */
	private computeRecoveryId(
		r: Uint8Array,
		s: Uint8Array,
		messageHash: Uint8Array,
		expectedPublicKey: Uint8Array,
	): number {
		const rBig = BigInt(`0x${Buffer.from(r).toString('hex')}`);
		const sBig = BigInt(`0x${Buffer.from(s).toString('hex')}`);
		const expectedHex = toHex(expectedPublicKey);

		for (const recoveryBit of [0, 1] as const) {
			try {
				const sig = new secp256k1.Signature(rBig, sBig).addRecoveryBit(
					recoveryBit,
				);
				const recovered = sig.recoverPublicKey(messageHash);
				const recoveredHex = toHex(recovered.toBytes(true));
				if (recoveredHex === expectedHex) {
					return recoveryBit + 27;
				}
			} catch {
				// Try next recovery bit
			}
		}

		throw new Error(
			'Failed to compute recovery ID: neither v=27 nor v=28 recovers the expected public key',
		);
	}
}
