//! Per-party interactive signing state machine for CGGMP24.
//!
//! Each party holds one [`SignSession`] that wraps the unnameable
//! `StateMachine` type behind a type-erased `DynSignSM` trait object.
//! Sessions are stored in a thread-local `HashMap<String, SignSession>`.
//!
//! The WASM boundary exposes three functions:
//! - `create_session`  → initialise state machine, return first messages
//! - `process_round`   → feed incoming messages, drive until NeedsOneMoreMessage or Output
//! - `destroy_session` → drop and reclaim memory
//!
//! WASM is single-threaded, so leaked heap pointers for `'static` storage
//! are safe — `Drop` reclaims them in a defined order.

use std::cell::RefCell;
use std::collections::HashMap;
use std::mem::ManuallyDrop;

use generic_ec::Scalar;
use rand::rngs::OsRng;
use round_based::state_machine::{ProceedResult, StateMachine};
use round_based::{Incoming, MessageDestination, MessageType};
use serde::{Deserialize, Serialize};

use cggmp24::security_level::SecurityLevel128;
use cggmp24::signing::PrehashedDataToSign;
use cggmp24::supported_curves::Secp256k1;

use crate::types::{MpcMessage, MpcRecipient, SignatureResult};

// ---------------------------------------------------------------------------
// Type-erased state machine trait
// ---------------------------------------------------------------------------

/// Result from driving the state machine one step.
enum DriveOneResult {
    /// Protocol emitted an outgoing message.
    SendMsg(MpcMessage),
    /// Protocol needs one more incoming message before it can continue.
    NeedsInput,
    /// Protocol finished — signature is available.
    Finished(SignatureResult),
    /// Protocol yielded control — continue driving.
    Yielded,
}

/// Object-safe trait wrapping the unnameable `StateMachine` concrete type.
trait DynSignSM {
    /// Drive the state machine one step (call `proceed()`).
    fn drive_one(&mut self, party_index: u16) -> Result<DriveOneResult, String>;

    /// Feed a single incoming message from a remote party.
    fn receive_msg(&mut self, sender: u16, msg_type: u8, payload: &[u8]) -> Result<(), String>;
}

/// Wrapper that implements `DynSignSM` for a concrete signing `StateMachine`.
struct SmWrapper<SM: StateMachine> {
    sm: SM,
}

impl<SM> DynSignSM for SmWrapper<SM>
where
    SM: StateMachine<Output = Result<cggmp24::signing::Signature<Secp256k1>, cggmp24::signing::SigningError>>,
    SM::Msg: Serialize + for<'de> Deserialize<'de> + Clone,
{
    fn drive_one(&mut self, party_index: u16) -> Result<DriveOneResult, String> {
        match self.sm.proceed() {
            ProceedResult::SendMsg(outgoing) => {
                // Serialize the protocol message to JSON, then base64
                let json_bytes = serde_json::to_vec(&outgoing.msg)
                    .map_err(|e| format!("serialize outgoing msg: {e}"))?;
                let payload = base64::engine::general_purpose::STANDARD.encode(&json_bytes);

                let recipient = match outgoing.recipient {
                    MessageDestination::AllParties => {
                        MpcRecipient::Broadcast("all".into())
                    }
                    MessageDestination::OneParty(p) => MpcRecipient::Party(p),
                };

                Ok(DriveOneResult::SendMsg(MpcMessage {
                    sender: party_index,
                    recipient,
                    payload,
                }))
            }
            ProceedResult::NeedsOneMoreMessage => Ok(DriveOneResult::NeedsInput),
            ProceedResult::Output(result) => {
                // Output is Result<Signature<Secp256k1>, SigningError>
                let sig = result.map_err(|e| format!("signing protocol error: {e:?}"))?;
                // Normalize s to low-s form (required for Ethereum)
                let sig = sig.normalize_s();
                // Extract r, s as 32-byte big-endian arrays
                let mut sig_bytes = vec![0u8; cggmp24::signing::Signature::<Secp256k1>::serialized_len()];
                sig.write_to_slice(&mut sig_bytes);

                Ok(DriveOneResult::Finished(SignatureResult {
                    r: sig_bytes[..32].to_vec(),
                    s: sig_bytes[32..].to_vec(),
                }))
            }
            ProceedResult::Yielded => Ok(DriveOneResult::Yielded),
            ProceedResult::Error(e) => Err(format!("protocol error: {e}")),
        }
    }

    fn receive_msg(&mut self, sender: u16, msg_type: u8, payload: &[u8]) -> Result<(), String> {
        use base64::Engine;
        // payload is base64-encoded JSON of the protocol message
        let json_bytes = base64::engine::general_purpose::STANDARD
            .decode(payload)
            .map_err(|e| format!("base64 decode incoming msg: {e}"))?;
        let msg: SM::Msg = serde_json::from_slice(&json_bytes)
            .map_err(|e| format!("deserialize incoming msg: {e}"))?;

        let incoming = Incoming {
            id: 0, // ID is not used by the protocol implementation
            sender,
            msg_type: if msg_type == 0 {
                MessageType::Broadcast
            } else {
                MessageType::P2P
            },
            msg,
        };

        self.sm
            .received_msg(incoming)
            .map_err(|_| "failed to deliver message to state machine".to_string())
    }
}

// ---------------------------------------------------------------------------
// Sign Session
// ---------------------------------------------------------------------------

/// A signing session owning the type-erased state machine and leaked memory.
pub struct SignSession {
    /// Type-erased state machine (dropped first via ManuallyDrop)
    sm: ManuallyDrop<Box<dyn DynSignSM>>,
    /// Party index (at keygen) for this session's participant
    party_index: u16,
    /// Keygen indices of all parties in this signing session.
    /// Used to map between keygen indices (wire format) and 0-based
    /// positions (what the round_based state machine expects).
    parties_at_keygen: Vec<u16>,
    /// Leaked KeyShare pointer (reclaimed on Drop)
    _key_share_ptr: *mut cggmp24::KeyShare<Secp256k1, SecurityLevel128>,
    /// Leaked OsRng pointer (reclaimed on Drop)
    _rng_ptr: *mut OsRng,
    /// Leaked PrehashedDataToSign pointer (reclaimed on Drop)
    _prehashed_ptr: *mut PrehashedDataToSign<Secp256k1>,
    /// Signature output (set when protocol completes)
    pub signature: Option<SignatureResult>,
}

impl Drop for SignSession {
    fn drop(&mut self) {
        // 1. Drop the state machine first (it references the leaked data)
        unsafe {
            ManuallyDrop::drop(&mut self.sm);
        }
        // 2. Reclaim leaked memory
        if !self._key_share_ptr.is_null() {
            unsafe { drop(Box::from_raw(self._key_share_ptr)); }
        }
        if !self._rng_ptr.is_null() {
            unsafe { drop(Box::from_raw(self._rng_ptr)); }
        }
        if !self._prehashed_ptr.is_null() {
            unsafe { drop(Box::from_raw(self._prehashed_ptr)); }
        }
    }
}

// SAFETY: WASM is single-threaded, so Send is fine.
unsafe impl Send for SignSession {}

// ---------------------------------------------------------------------------
// Session storage
// ---------------------------------------------------------------------------

thread_local! {
    static SESSIONS: RefCell<HashMap<String, SignSession>> = RefCell::new(HashMap::new());
}

// ---------------------------------------------------------------------------
// Message type for WASM boundary
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
pub struct WasmSignMessage {
    pub sender: u16,
    pub is_broadcast: bool,
    pub recipient: Option<u16>,
    pub payload: String, // base64-encoded serde_json of Msg<Secp256k1, Sha256>
}

#[derive(Serialize, Deserialize)]
pub struct CreateSessionResult {
    pub session_id: String,
    pub messages: Vec<WasmSignMessage>,
}

#[derive(Serialize, Deserialize)]
pub struct ProcessRoundResult {
    pub messages: Vec<WasmSignMessage>,
    pub complete: bool,
    pub signature: Option<SignatureResult>,
}

// ---------------------------------------------------------------------------
// Public API (called from lib.rs WASM exports)
// ---------------------------------------------------------------------------

use base64::Engine;

/// Create a new signing session for one party.
///
/// # Arguments
/// - `core_share_bytes`: serialized CoreKeyShare (serde_json)
/// - `aux_info_bytes`: serialized AuxInfo (serde_json)
/// - `message_hash`: 32-byte hash to sign
/// - `party_index`: this party's index at keygen time (0-based)
/// - `parties_at_keygen`: indices of all parties participating in signing
/// - `eid_bytes`: execution ID (32 bytes)
///
/// # Returns
/// `CreateSessionResult` with session ID and initial outgoing messages.
pub fn create_session(
    core_share_bytes: &[u8],
    aux_info_bytes: &[u8],
    message_hash: &[u8],
    party_index: u16,
    parties_at_keygen: &[u16],
    eid_bytes: &[u8],
) -> Result<CreateSessionResult, String> {
    // Deserialize key material
    let core_share: cggmp24::IncompleteKeyShare<Secp256k1> =
        serde_json::from_slice(core_share_bytes)
            .map_err(|e| format!("deserialize CoreKeyShare: {e}"))?;

    let aux_info: cggmp24::key_share::AuxInfo<SecurityLevel128> =
        serde_json::from_slice(aux_info_bytes)
            .map_err(|e| format!("deserialize AuxInfo: {e}"))?;

    let key_share = cggmp24::KeyShare::from_parts((core_share, aux_info))
        .map_err(|e| format!("combine key share: {e}"))?;

    // Leak the key share to get a 'static reference (reclaimed on Drop)
    let key_share_ptr = Box::into_raw(Box::new(key_share));
    let key_share_ref: &'static cggmp24::KeyShare<Secp256k1, SecurityLevel128> =
        unsafe { &*key_share_ptr };

    // Build the prehashed data to sign
    if message_hash.len() != 32 {
        // Clean up leaked memory on error
        unsafe { drop(Box::from_raw(key_share_ptr)); }
        return Err(format!(
            "message_hash must be 32 bytes, got {}",
            message_hash.len()
        ));
    }
    let scalar = Scalar::<Secp256k1>::from_be_bytes_mod_order(message_hash);
    let prehashed_ptr = Box::into_raw(Box::new(PrehashedDataToSign::from_scalar(scalar)));
    let prehashed_ref: &'static PrehashedDataToSign<Secp256k1> =
        unsafe { &*prehashed_ptr };

    // Build execution ID — leak eid bytes for 'static lifetime
    let eid_owned: Box<[u8]> = eid_bytes.to_vec().into_boxed_slice();
    let eid_static: &'static [u8] = Box::leak(eid_owned);
    let eid = cggmp24::ExecutionId::new(eid_static);

    // Build parties list — leak for 'static lifetime
    let parties_owned: Box<[u16]> = parties_at_keygen.to_vec().into_boxed_slice();
    let parties_static: &'static [u16] = Box::leak(parties_owned);

    // Leak rng for 'static lifetime
    let rng_ptr = Box::into_raw(Box::new(OsRng));
    let rng_ref: &'static mut OsRng = unsafe { &mut *rng_ptr };

    // Map party_index (keygen index) → position within the parties array.
    // The cggmp24 crate expects `i` to be the 0-based position, not the
    // keygen party index. For parties=[0,1] the two are identical, but for
    // parties=[1,2] keygen index 2 is at position 1.
    let party_position = parties_at_keygen
        .iter()
        .position(|&p| p == party_index)
        .ok_or_else(|| {
            // Clean up leaked memory on error
            unsafe {
                drop(Box::from_raw(key_share_ptr));
                drop(Box::from_raw(prehashed_ptr));
                drop(Box::from_raw(rng_ptr));
            }
            format!(
                "party_index {} not found in parties {:?}",
                party_index, parties_at_keygen
            )
        })? as u16;

    // Create the signing state machine
    // - `party_position`: 0-based index of this party within the signing group
    // - `parties_static`: keygen indices of all parties in the signing group
    let sm = cggmp24::signing(eid, party_position, parties_static, key_share_ref)
        .enforce_reliable_broadcast(true)
        .sign_sync(rng_ref, prehashed_ref);

    // Wrap in type-erased wrapper
    let dyn_sm: Box<dyn DynSignSM> = Box::new(SmWrapper { sm });

    let mut session = SignSession {
        sm: ManuallyDrop::new(dyn_sm),
        party_index,
        parties_at_keygen: parties_at_keygen.to_vec(),
        _key_share_ptr: key_share_ptr,
        _rng_ptr: rng_ptr,
        _prehashed_ptr: prehashed_ptr,
        signature: None,
    };

    // Drive the state machine to produce initial messages
    let messages = drive_batch(&mut session)?;

    // Generate session ID
    let session_id = uuid_v4();

    // Store session
    SESSIONS.with(|sessions| {
        sessions.borrow_mut().insert(session_id.clone(), session);
    });

    Ok(CreateSessionResult {
        session_id,
        messages,
    })
}

/// Process a round of incoming messages for an existing session.
///
/// For each incoming message: deliver to the state machine, then drive
/// until NeedsInput or Output.
pub fn process_round(
    session_id: &str,
    incoming: &[WasmSignMessage],
) -> Result<ProcessRoundResult, String> {
    SESSIONS.with(|sessions| {
        let mut sessions = sessions.borrow_mut();
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("no sign session found: {session_id}"))?;

        let mut all_outgoing = Vec::new();
        let mut delivered = 0u32;

        // Deliver each incoming message, then drive.
        // Two key transformations:
        //   1. Filter out P2P messages not addressed to us.
        //   2. Map sender from keygen index (wire format) to 0-based
        //      position within the signing group (what the round_based
        //      state machine expects).
        for msg in incoming {
            // Filter: skip P2P messages not addressed to this party
            if !msg.is_broadcast {
                if let Some(recipient) = msg.recipient {
                    if recipient != session.party_index {
                        continue; // Not for us
                    }
                }
            }

            // Map sender from keygen index → position in parties array
            let sender_pos = session.parties_at_keygen
                .iter()
                .position(|&p| p == msg.sender)
                .ok_or_else(|| format!(
                    "unknown sender {} not in parties {:?}",
                    msg.sender, session.parties_at_keygen
                ))? as u16;

            let msg_type: u8 = if msg.is_broadcast { 0 } else { 1 };
            let payload_bytes = msg.payload.as_bytes();

            session
                .sm
                .receive_msg(sender_pos, msg_type, payload_bytes)?;

            delivered += 1;

            // Drive after each message delivery
            let batch = drive_batch(session)?;
            all_outgoing.extend(batch);
        }

        // If no messages were delivered, just drive (for initial round processing)
        if delivered == 0 {
            let batch = drive_batch(session)?;
            all_outgoing.extend(batch);
        }

        let complete = session.signature.is_some();
        let signature = session.signature.clone();

        Ok(ProcessRoundResult {
            messages: all_outgoing,
            complete,
            signature,
        })
    })
}

/// Destroy a signing session, freeing all resources.
pub fn destroy_session(session_id: &str) -> bool {
    SESSIONS.with(|sessions| sessions.borrow_mut().remove(session_id).is_some())
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Drive the state machine until it needs input or produces output.
/// Collects all outgoing messages produced along the way.
fn drive_batch(session: &mut SignSession) -> Result<Vec<WasmSignMessage>, String> {
    let mut messages = Vec::new();

    loop {
        match session.sm.drive_one(session.party_index)? {
            DriveOneResult::SendMsg(mpc_msg) => {
                let wasm_msg = mpc_msg_to_wasm(mpc_msg, &session.parties_at_keygen);
                messages.push(wasm_msg);
                // Continue driving
            }
            DriveOneResult::NeedsInput => {
                // State machine needs more messages — stop driving
                break;
            }
            DriveOneResult::Finished(sig) => {
                session.signature = Some(sig);
                break;
            }
            DriveOneResult::Yielded => {
                // Continue driving
            }
        }
    }

    Ok(messages)
}

/// Convert an internal MpcMessage to a WasmSignMessage for the wire format.
///
/// The protocol's `MessageDestination::OneParty(p)` uses 0-based position
/// indices within the signing group. We map these to keygen indices using
/// the `parties` array so the wire format uses consistent keygen indices.
fn mpc_msg_to_wasm(msg: MpcMessage, parties: &[u16]) -> WasmSignMessage {
    let (is_broadcast, recipient) = match &msg.recipient {
        MpcRecipient::Broadcast(_) => (true, None),
        MpcRecipient::Party(p) => {
            // Map position → keygen index
            let keygen_idx = parties.get(*p as usize).copied().unwrap_or(*p);
            (false, Some(keygen_idx))
        }
    };
    WasmSignMessage {
        sender: msg.sender,
        is_broadcast,
        recipient,
        payload: msg.payload,
    }
}

/// Generate a v4 UUID (random) without pulling in the uuid crate.
fn uuid_v4() -> String {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).expect("getrandom failed");
    // Set version 4
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    // Set variant
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
    )
}
