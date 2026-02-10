import type { CurveName } from '../enums/curve-name.js';
import type { SchemeName } from '../enums/scheme-name.js';

export interface DKGRoundResult {
	readonly outgoing: Uint8Array[];
	readonly finished: boolean;
	readonly publicKey?: Uint8Array;
	readonly shares?: Uint8Array[];
}

export interface IThresholdScheme {
	readonly name: SchemeName;
	readonly curve: CurveName;

	/** Run one round of the DKG ceremony. */
	dkg(sessionId: string, round: number, incoming: Uint8Array[]): Promise<DKGRoundResult>;

	/** Derive an Ethereum address from a compressed or uncompressed public key. */
	deriveAddress(publicKey: Uint8Array): string;

	/** Create an interactive signing session from serialized keyshares. */
	createSignSession(keyshareBytes: Uint8Array[]): {
		sessionId: string;
		firstMessages: Uint8Array[];
	};

	/** Process one round of the interactive signing protocol. */
	processSignRound(
		sessionId: string,
		incomingMessages: Uint8Array[],
	): {
		outgoingMessages: Uint8Array[];
		presigned: boolean;
	};

	/** Finalize a presigned session with the actual message hash. */
	finalizeSign(
		sessionId: string,
		messageHash: Uint8Array,
		incomingLastMessages: Uint8Array[],
	): {
		r: Uint8Array;
		s: Uint8Array;
		v: number;
	};
}
