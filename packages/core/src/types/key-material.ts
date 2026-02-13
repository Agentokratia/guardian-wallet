/**
 * CGGMP24 key material is split into two parts:
 * - CoreKeyShare: from the keygen ceremony (contains the secret share + public data)
 * - AuxInfo: from the aux_info_gen ceremony (Paillier keys + ring-Pedersen params)
 *
 * Both are needed to participate in signing.
 */
export interface KeyMaterial {
	readonly coreShare: Uint8Array;
	readonly auxInfo: Uint8Array;
}
