//! Serde types for JS interop.
//!
//! These types are serialised to/from JS via serde-wasm-bindgen.
//! Currently only used for signing session state (future).

use serde::{Deserialize, Serialize};

/// Result from a round of a signing protocol (per-party, for HTTP round-trips).
#[derive(Serialize, Deserialize)]
pub struct RoundResult {
    /// Serialised state machine bytes (opaque, pass back to next round)
    pub state: Vec<u8>,
    /// Outgoing messages to send to other parties
    pub outgoing: Vec<MpcMessage>,
    /// Whether the protocol has finished
    pub finished: bool,
}

/// Message exchanged between parties during MPC protocols.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MpcMessage {
    pub sender: u16,
    pub recipient: MpcRecipient,
    /// base64-encoded payload
    pub payload: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(untagged)]
pub enum MpcRecipient {
    Broadcast(String),
    Party(u16),
}

/// Full signing result.
#[derive(Serialize, Deserialize, Clone)]
pub struct SignatureResult {
    pub r: Vec<u8>,
    pub s: Vec<u8>,
}
