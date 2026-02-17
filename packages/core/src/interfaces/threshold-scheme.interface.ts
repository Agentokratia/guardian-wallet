import type { CurveName } from '../enums/curve-name.js';
import type { SchemeName } from '../enums/scheme-name.js';

export interface DKGRoundResult {
	readonly outgoing: Uint8Array[];
	readonly finished: boolean;
	readonly publicKey?: Uint8Array;
	readonly shares?: Uint8Array[];
}

/** Result from an aux-info generation round (CGGMP24 two-phase DKG). */
export interface AuxInfoRoundResult {
	readonly outgoing: Uint8Array[];
	readonly finished: boolean;
	/** Serialised AuxInfo blobs (one per party) — present when finished=true. */
	readonly auxInfos?: Uint8Array[];
}

export interface IThresholdScheme {
	readonly name: SchemeName;
	readonly curve: CurveName;

	// ---- Two-phase DKG (CGGMP24) ----

	/**
	 * Run one round of the auxiliary info generation ceremony.
	 * Phase A of the CGGMP24 two-phase DKG — generates Paillier key pairs
	 * and ring-Pedersen parameters needed for signing.
	 */
	auxInfoGen(sessionId: string, round: number, incoming: Uint8Array[]): Promise<AuxInfoRoundResult>;

	/**
	 * Run one round of the key generation ceremony.
	 * Phase B of the CGGMP24 two-phase DKG — generates CoreKeyShares.
	 */
	dkg(sessionId: string, round: number, incoming: Uint8Array[]): Promise<DKGRoundResult>;

	/** Derive an Ethereum address from a compressed or uncompressed public key. */
	deriveAddress(publicKey: Uint8Array): string;

	/**
	 * Extract the shared public key from a serialised CoreKeyShare.
	 * Returns 33-byte compressed secp256k1 public key.
	 * Optional — not all scheme implementations may support this.
	 */
	extractPublicKey?(keyShareBytes: Uint8Array): Uint8Array;

	// ---- Interactive signing (hash required upfront) ----

	/**
	 * Create an interactive signing session from key material.
	 *
	 * @param keyMaterialBytes - [coreShare, auxInfo] — two serialised blobs
	 * @param messageHash - 32-byte hash to sign (required upfront in CGGMP24)
	 * @param options - Optional party config for the signing session
	 */
	createSignSession(
		keyMaterialBytes: Uint8Array[],
		messageHash: Uint8Array,
		options?: {
			partyIndex?: number;
			partiesAtKeygen?: number[];
			eid?: Uint8Array;
			/** Force WASM backend for cross-compatibility with browser signing. */
			forceWasm?: boolean;
		},
	): Promise<{
		sessionId: string;
		firstMessages: Uint8Array[];
	}>;

	/**
	 * Process one round of the interactive signing protocol.
	 *
	 * @returns outgoingMessages and whether the protocol is complete.
	 */
	processSignRound(
		sessionId: string,
		incomingMessages: Uint8Array[],
	): Promise<{
		outgoingMessages: Uint8Array[];
		complete: boolean;
	}>;

	/**
	 * Extract the final signature from a completed signing session.
	 * No lastMessage step — CGGMP24 produces the signature when the
	 * protocol completes.
	 */
	finalizeSign(sessionId: string): Promise<{
		r: Uint8Array;
		s: Uint8Array;
		v: number;
	}>;

	// ---- Presignature support (CGGMP24 native) ----

	/**
	 * Create a presignature session — produces a reusable presignature
	 * that enables instant non-interactive signing later.
	 */
	createPresignSession(keyMaterialBytes: Uint8Array[]): {
		sessionId: string;
		firstMessages: Uint8Array[];
	};

	/** Process one round of the presignature generation protocol. */
	processPresignRound(
		sessionId: string,
		incomingMessages: Uint8Array[],
	): {
		outgoingMessages: Uint8Array[];
		complete: boolean;
	};

	/** Extract the presignature and commitment from a completed session. */
	extractPresignature(sessionId: string): {
		presignature: Uint8Array;
		commitment: Uint8Array;
	};

	/**
	 * Issue a partial signature from a presignature (non-interactive, instant).
	 */
	issuePartialSignature(presignature: Uint8Array, messageHash: Uint8Array): Uint8Array;

	/**
	 * Combine partial signatures into a full ECDSA signature.
	 */
	combinePartialSignatures(
		partials: Uint8Array[],
		commitment: Uint8Array,
		messageHash: Uint8Array,
	): {
		r: Uint8Array;
		s: Uint8Array;
		v: number;
	};
}
