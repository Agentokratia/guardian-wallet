//! WASM wrapper for CGGMP24 threshold ECDSA.
//!
//! Provides:
//! - `run_dkg`: Full DKG ceremony (aux_info_gen + keygen) for all parties locally
//! - `combine_key_share`: Merge CoreKeyShare + AuxInfo into full KeyShare
//! - `extract_public_key`: Get shared public key from serialised key share
//! - `pregenerate_paillier_primes`: Pre-generate expensive Paillier primes
//!
//! DKG runs all parties locally (server-side). Signing uses per-party
//! state machines driven by HTTP round-trips (not yet implemented).

// ─── Critical-section implementation for WASM ────────────────────────────────
// WASM is single-threaded so a no-op critical section is safe.
// This resolves the missing `_critical_section_1_0_acquire` / `_release`
// imports that the `std` feature of `critical-section` fails to provide
// on `wasm32-unknown-unknown`.
struct WasmCriticalSection;
critical_section::set_impl!(WasmCriticalSection);

unsafe impl critical_section::Impl for WasmCriticalSection {
    unsafe fn acquire() -> critical_section::RawRestoreState {
        // WASM is single-threaded — nothing to lock.
    }

    unsafe fn release(_restore_state: critical_section::RawRestoreState) {
        // Nothing to unlock.
    }
}

mod sign;
mod simulate;
mod types;

use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use cggmp24::key_share::AnyKeyShare;
use cggmp24::security_level::SecurityLevel128;
use cggmp24::supported_curves::Secp256k1;

/// Initialise the WASM module (called once from JS).
#[wasm_bindgen(start)]
pub fn init() {
    // No-op for now. Panic hook can be added later if needed.
}

// ─── DKG Result Types ───────────────────────────────────────────────────────

/// A single party's key material from DKG.
#[derive(Serialize, Deserialize)]
struct DkgShare {
    /// Serialised CoreKeyShare (serde_json bytes)
    core_share: Vec<u8>,
    /// Serialised AuxInfo (serde_json bytes)
    aux_info: Vec<u8>,
}

/// Complete DKG result: key shares for all parties + shared public key.
#[derive(Serialize, Deserialize)]
struct DkgResult {
    /// One DkgShare per party (index 0..n)
    shares: Vec<DkgShare>,
    /// 33-byte compressed secp256k1 shared public key
    public_key: Vec<u8>,
}

// ─── Full DKG (all parties local) ────────────────────────────────────────────

/// Run a complete two-phase DKG ceremony for `n` parties with threshold `t`.
///
/// Phase A: Auxiliary info generation (Paillier primes — computationally expensive)
/// Phase B: Key generation (lightweight ECDSA key shares)
///
/// All parties run locally via protocol simulation. Returns a JSON object
/// containing key shares for each party and the shared public key.
///
/// The caller (server) distributes shares:
/// - Share[0] → signer (encrypted .share.enc file)
/// - Share[1] → server (stored in Vault)
/// - Share[2] → user (wallet-encrypted, returned to browser)
#[wasm_bindgen]
pub fn run_dkg(eid_bytes: &[u8], n: u16, threshold: u16) -> Result<JsValue, JsError> {
    if n < 2 {
        return Err(JsError::new("n must be at least 2"));
    }
    if threshold < 2 || threshold > n {
        return Err(JsError::new(&format!(
            "threshold must be in [2, {n}], got {threshold}"
        )));
    }

    // Phase A: Auxiliary Info Generation
    // Generates Paillier key pairs for each party (expensive: ~30-60s per party)
    let mut aux_parties = Vec::new();
    for i in 0..n {
        let eid = cggmp24::ExecutionId::new(eid_bytes);
        let primes: cggmp24::PregeneratedPrimes<SecurityLevel128> =
            cggmp24::PregeneratedPrimes::generate(&mut OsRng);
        aux_parties.push(round_based::state_machine::wrap_protocol(
            move |party| async move {
                let mut rng = OsRng;
                cggmp24::aux_info_gen(eid, i, n, primes)
                    .start(&mut rng, party)
                    .await
            },
        ));
    }

    let aux_results = simulate::run(aux_parties)
        .map_err(|e| JsError::new(&format!("aux_info_gen failed: {e}")))?;

    let mut aux_infos = Vec::new();
    for (i, result) in aux_results.into_iter().enumerate() {
        let aux = result
            .map_err(|e| JsError::new(&format!("aux_info_gen party {i} failed: {e:?}")))?;
        aux_infos.push(aux);
    }

    // Phase B: Key Generation
    // Generates threshold ECDSA key shares (lightweight: ~2-5s)
    let mut kg_parties = Vec::new();
    for i in 0..n {
        let eid = cggmp24::ExecutionId::new(eid_bytes);
        kg_parties.push(round_based::state_machine::wrap_protocol(
            move |party| async move {
                let mut rng = OsRng;
                cggmp24::keygen::<Secp256k1>(eid, i, n)
                    .set_threshold(threshold)
                    .start(&mut rng, party)
                    .await
            },
        ));
    }

    let kg_results = simulate::run(kg_parties)
        .map_err(|e| JsError::new(&format!("keygen failed: {e}")))?;

    let mut core_shares = Vec::new();
    for (i, result) in kg_results.into_iter().enumerate() {
        let share = result
            .map_err(|e| JsError::new(&format!("keygen party {i} failed: {e:?}")))?;
        core_shares.push(share);
    }

    // Extract shared public key (same for all parties)
    let pk = core_shares[0].shared_public_key();
    let pk_bytes = pk.to_bytes(true); // 33-byte compressed

    // Serialize each party's key material
    let mut shares = Vec::new();
    for i in 0..n as usize {
        let core_bytes = serde_json::to_vec(&core_shares[i])
            .map_err(|e| JsError::new(&format!("serialize core share {i}: {e}")))?;
        let aux_bytes = serde_json::to_vec(&aux_infos[i])
            .map_err(|e| JsError::new(&format!("serialize aux info {i}: {e}")))?;
        shares.push(DkgShare {
            core_share: core_bytes,
            aux_info: aux_bytes,
        });
    }

    let result = DkgResult {
        shares,
        public_key: pk_bytes.as_bytes().to_vec(),
    };

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
}

// ─── DKG with Pre-generated Primes (fast path) ──────────────────────────────

/// Run a complete two-phase DKG ceremony using pre-generated Paillier primes.
///
/// This is the FAST path — Paillier prime generation (~30-60s per party) is
/// skipped because primes were generated ahead of time (e.g. during server
/// startup in a background worker thread).
///
/// `serialized_primes` is a JS array of `Uint8Array`, one per party,
/// each being the serde_json serialization of `PregeneratedPrimes`.
#[wasm_bindgen]
pub fn run_dkg_with_primes(
    eid_bytes: &[u8],
    n: u16,
    threshold: u16,
    serialized_primes: JsValue,
) -> Result<JsValue, JsError> {
    if n < 2 {
        return Err(JsError::new("n must be at least 2"));
    }
    if threshold < 2 || threshold > n {
        return Err(JsError::new(&format!(
            "threshold must be in [2, {n}], got {threshold}"
        )));
    }

    // Deserialize the pre-generated primes from JS
    let primes_bytes: Vec<Vec<u8>> = serde_wasm_bindgen::from_value(serialized_primes)
        .map_err(|e| JsError::new(&format!("deserialize primes array: {e}")))?;

    if primes_bytes.len() < n as usize {
        return Err(JsError::new(&format!(
            "need {} sets of primes, got {}",
            n,
            primes_bytes.len()
        )));
    }

    // Phase A: Auxiliary Info Generation (using pre-generated primes — FAST)
    let mut aux_parties = Vec::new();
    for i in 0..n {
        let eid = cggmp24::ExecutionId::new(eid_bytes);
        let primes: cggmp24::PregeneratedPrimes<SecurityLevel128> =
            serde_json::from_slice(&primes_bytes[i as usize])
                .map_err(|e| JsError::new(&format!("deserialize primes for party {i}: {e}")))?;
        aux_parties.push(round_based::state_machine::wrap_protocol(
            move |party| async move {
                let mut rng = OsRng;
                cggmp24::aux_info_gen(eid, i, n, primes)
                    .start(&mut rng, party)
                    .await
            },
        ));
    }

    let aux_results = simulate::run(aux_parties)
        .map_err(|e| JsError::new(&format!("aux_info_gen failed: {e}")))?;

    let mut aux_infos = Vec::new();
    for (i, result) in aux_results.into_iter().enumerate() {
        let aux = result
            .map_err(|e| JsError::new(&format!("aux_info_gen party {i} failed: {e:?}")))?;
        aux_infos.push(aux);
    }

    // Phase B: Key Generation (lightweight: ~2-5s)
    let mut kg_parties = Vec::new();
    for i in 0..n {
        let eid = cggmp24::ExecutionId::new(eid_bytes);
        kg_parties.push(round_based::state_machine::wrap_protocol(
            move |party| async move {
                let mut rng = OsRng;
                cggmp24::keygen::<Secp256k1>(eid, i, n)
                    .set_threshold(threshold)
                    .start(&mut rng, party)
                    .await
            },
        ));
    }

    let kg_results = simulate::run(kg_parties)
        .map_err(|e| JsError::new(&format!("keygen failed: {e}")))?;

    let mut core_shares = Vec::new();
    for (i, result) in kg_results.into_iter().enumerate() {
        let share = result
            .map_err(|e| JsError::new(&format!("keygen party {i} failed: {e:?}")))?;
        core_shares.push(share);
    }

    // Extract shared public key (same for all parties)
    let pk = core_shares[0].shared_public_key();
    let pk_bytes = pk.to_bytes(true); // 33-byte compressed

    // Serialize each party's key material
    let mut shares = Vec::new();
    for i in 0..n as usize {
        let core_bytes = serde_json::to_vec(&core_shares[i])
            .map_err(|e| JsError::new(&format!("serialize core share {i}: {e}")))?;
        let aux_bytes = serde_json::to_vec(&aux_infos[i])
            .map_err(|e| JsError::new(&format!("serialize aux info {i}: {e}")))?;
        shares.push(DkgShare {
            core_share: core_bytes,
            aux_info: aux_bytes,
        });
    }

    let result = DkgResult {
        shares,
        public_key: pk_bytes.as_bytes().to_vec(),
    };

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
}

// ─── Utility Functions ───────────────────────────────────────────────────────

/// Combine a CoreKeyShare (from keygen) with AuxInfo (from aux_info_gen)
/// into a full KeyShare suitable for signing.
///
/// Returns the serialised KeyShare bytes.
#[wasm_bindgen]
pub fn combine_key_share(
    core_key_share: &[u8],
    aux_info: &[u8],
) -> Result<Vec<u8>, JsError> {
    let iks: cggmp24::IncompleteKeyShare<Secp256k1> = serde_json::from_slice(core_key_share)
        .map_err(|e| JsError::new(&format!("deserialize CoreKeyShare: {e}")))?;

    let aux: cggmp24::key_share::AuxInfo<SecurityLevel128> = serde_json::from_slice(aux_info)
        .map_err(|e| JsError::new(&format!("deserialize AuxInfo: {e}")))?;

    let key_share = cggmp24::KeyShare::from_parts((iks, aux))
        .map_err(|e| JsError::new(&format!("combine key share: {e}")))?;

    serde_json::to_vec(&key_share)
        .map_err(|e| JsError::new(&format!("serialize KeyShare: {e}")))
}

/// Extract the shared public key from a serialised KeyShare or CoreKeyShare.
///
/// Returns 33-byte compressed secp256k1 public key.
#[wasm_bindgen]
pub fn extract_public_key(key_share_bytes: &[u8]) -> Result<Vec<u8>, JsError> {
    // Try as full KeyShare first
    if let Ok(ks) =
        serde_json::from_slice::<cggmp24::KeyShare<Secp256k1, SecurityLevel128>>(key_share_bytes)
    {
        let pk = ks.shared_public_key();
        let encoded = pk.to_bytes(true);
        return Ok(encoded.as_bytes().to_vec());
    }

    // Try as CoreKeyShare (IncompleteKeyShare)
    if let Ok(iks) =
        serde_json::from_slice::<cggmp24::IncompleteKeyShare<Secp256k1>>(key_share_bytes)
    {
        let pk = iks.shared_public_key();
        let encoded = pk.to_bytes(true);
        return Ok(encoded.as_bytes().to_vec());
    }

    Err(JsError::new(
        "failed to deserialize as KeyShare or CoreKeyShare",
    ))
}

/// Pre-generate Paillier primes for aux_info_gen.
///
/// This is the expensive part (~30-60s). Call this ahead of time
/// and store the result. Pass serialised primes to speed up DKG.
///
/// Returns serialised PregeneratedPrimes.
#[wasm_bindgen]
pub fn pregenerate_paillier_primes() -> Result<Vec<u8>, JsError> {
    let primes: cggmp24::PregeneratedPrimes<SecurityLevel128> =
        cggmp24::PregeneratedPrimes::generate(&mut OsRng);
    serde_json::to_vec(&primes).map_err(|e| JsError::new(&format!("serialize primes: {e}")))
}

// ─── Interactive Signing ────────────────────────────────────────────────────

/// Create an interactive signing session for one party.
///
/// # Arguments
/// - `core_share`: serialised CoreKeyShare (serde_json bytes)
/// - `aux_info`: serialised AuxInfo (serde_json bytes)
/// - `message_hash`: 32-byte hash to sign
/// - `party_index`: this party's index at keygen time (0-based)
/// - `parties_at_keygen`: array of party indices participating in signing
/// - `eid`: execution ID bytes (32 bytes)
///
/// # Returns
/// JS object: `{ session_id: string, messages: WasmSignMessage[] }`
#[wasm_bindgen]
pub fn sign_create_session(
    core_share: &[u8],
    aux_info: &[u8],
    message_hash: &[u8],
    party_index: u16,
    parties_at_keygen: &[u16],
    eid: &[u8],
) -> Result<JsValue, JsError> {
    let result = sign::create_session(
        core_share,
        aux_info,
        message_hash,
        party_index,
        parties_at_keygen,
        eid,
    )
    .map_err(|e| JsError::new(&e))?;

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Process a round of incoming messages for an existing signing session.
///
/// # Arguments
/// - `session_id`: the session ID returned by `sign_create_session`
/// - `incoming_messages`: JS array of `WasmSignMessage` objects
///
/// # Returns
/// JS object: `{ messages: WasmSignMessage[], complete: bool, signature?: { r, s } }`
#[wasm_bindgen]
pub fn sign_process_round(
    session_id: &str,
    incoming_messages: JsValue,
) -> Result<JsValue, JsError> {
    let incoming: Vec<sign::WasmSignMessage> = serde_wasm_bindgen::from_value(incoming_messages)
        .map_err(|e| JsError::new(&format!("deserialize incoming messages: {e}")))?;

    let result = sign::process_round(session_id, &incoming)
        .map_err(|e| JsError::new(&e))?;

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Destroy a signing session and free all resources.
///
/// Returns `true` if the session existed and was destroyed.
#[wasm_bindgen]
pub fn sign_destroy_session(session_id: &str) -> bool {
    sign::destroy_session(session_id)
}
