/* tslint:disable */
/* eslint-disable */

/**
 * Combine a CoreKeyShare (from keygen) with AuxInfo (from aux_info_gen)
 * into a full KeyShare suitable for signing.
 *
 * Returns the serialised KeyShare bytes.
 */
export function combine_key_share(core_key_share: Uint8Array, aux_info: Uint8Array): Uint8Array;

/**
 * Extract the shared public key from a serialised KeyShare or CoreKeyShare.
 *
 * Returns 33-byte compressed secp256k1 public key.
 */
export function extract_public_key(key_share_bytes: Uint8Array): Uint8Array;

/**
 * Initialise the WASM module (called once from JS).
 */
export function init(): void;

/**
 * Pre-generate Paillier primes for aux_info_gen.
 *
 * This is the expensive part (~30-60s). Call this ahead of time
 * and store the result. Pass serialised primes to speed up DKG.
 *
 * Returns serialised PregeneratedPrimes.
 */
export function pregenerate_paillier_primes(): Uint8Array;

/**
 * Run a complete two-phase DKG ceremony for `n` parties with threshold `t`.
 *
 * Phase A: Auxiliary info generation (Paillier primes — computationally expensive)
 * Phase B: Key generation (lightweight ECDSA key shares)
 *
 * All parties run locally via protocol simulation. Returns a JSON object
 * containing key shares for each party and the shared public key.
 *
 * The caller (server) distributes shares:
 * - Share[0] → signer (encrypted .share.enc file)
 * - Share[1] → server (stored in Vault)
 * - Share[2] → user (wallet-encrypted, returned to browser)
 */
export function run_dkg(eid_bytes: Uint8Array, n: number, threshold: number): any;

/**
 * Run a complete two-phase DKG ceremony using pre-generated Paillier primes.
 *
 * This is the FAST path — Paillier prime generation (~30-60s per party) is
 * skipped because primes were generated ahead of time (e.g. during server
 * startup in a background worker thread).
 *
 * `serialized_primes` is a JS array of `Uint8Array`, one per party,
 * each being the serde_json serialization of `PregeneratedPrimes`.
 */
export function run_dkg_with_primes(eid_bytes: Uint8Array, n: number, threshold: number, serialized_primes: any): any;

/**
 * Create an interactive signing session for one party.
 *
 * # Arguments
 * - `core_share`: serialised CoreKeyShare (serde_json bytes)
 * - `aux_info`: serialised AuxInfo (serde_json bytes)
 * - `message_hash`: 32-byte hash to sign
 * - `party_index`: this party's index at keygen time (0-based)
 * - `parties_at_keygen`: array of party indices participating in signing
 * - `eid`: execution ID bytes (32 bytes)
 *
 * # Returns
 * JS object: `{ session_id: string, messages: WasmSignMessage[] }`
 */
export function sign_create_session(core_share: Uint8Array, aux_info: Uint8Array, message_hash: Uint8Array, party_index: number, parties_at_keygen: Uint16Array, eid: Uint8Array): any;

/**
 * Destroy a signing session and free all resources.
 *
 * Returns `true` if the session existed and was destroyed.
 */
export function sign_destroy_session(session_id: string): boolean;

/**
 * Process a round of incoming messages for an existing signing session.
 *
 * # Arguments
 * - `session_id`: the session ID returned by `sign_create_session`
 * - `incoming_messages`: JS array of `WasmSignMessage` objects
 *
 * # Returns
 * JS object: `{ messages: WasmSignMessage[], complete: bool, signature?: { r, s } }`
 */
export function sign_process_round(session_id: string, incoming_messages: any): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly _critical_section_1_0_acquire: () => void;
    readonly combine_key_share: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly extract_public_key: (a: number, b: number) => [number, number, number, number];
    readonly pregenerate_paillier_primes: () => [number, number, number, number];
    readonly run_dkg: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly run_dkg_with_primes: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly sign_create_session: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number, number];
    readonly sign_destroy_session: (a: number, b: number) => number;
    readonly sign_process_round: (a: number, b: number, c: any) => [number, number, number];
    readonly _critical_section_1_0_release: () => void;
    readonly init: () => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
