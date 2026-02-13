//! Native DKG runner using GMP backend for fast Paillier operations.
//!
//! Runs the complete CGGMP24 two-phase DKG ceremony (aux_info_gen + keygen)
//! natively with the rug/GMP backend, which is 10-100x faster than WASM
//! for big number operations.
//!
//! Output: JSON to stdout with shares and public key.
//!
//! Usage:
//!   guardian-gen-primes dkg <n> <threshold> <eid_hex>
//!   guardian-gen-primes primes <count>

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, BufWriter, Write};

use base64::Engine;
use cggmp24::security_level::SecurityLevel128;
use cggmp24::supported_curves::Secp256k1;
use generic_ec::Scalar;
use rand::rngs::OsRng;
use round_based::state_machine::{ProceedResult, StateMachine};
use round_based::{Incoming, MessageDestination, MessageType};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Simulation (same logic as simulate.rs in WASM crate)
// ---------------------------------------------------------------------------

fn simulate<S>(mut parties: Vec<S>) -> Result<Vec<S::Output>, String>
where
    S: StateMachine,
    S::Msg: Clone,
{
    let n = parties.len();
    let mut queues: Vec<VecDeque<Incoming<S::Msg>>> = (0..n).map(|_| VecDeque::new()).collect();
    let mut wants_msg = vec![false; n];
    let mut outputs: Vec<Option<S::Output>> = (0..n).map(|_| None).collect();
    let mut done = 0;
    let mut next_id: u64 = 0;

    for _ in 0..100_000 {
        for i in 0..n {
            if outputs[i].is_some() {
                continue;
            }
            loop {
                if wants_msg[i] {
                    if let Some(msg) = queues[i].pop_front() {
                        parties[i]
                            .received_msg(msg)
                            .map_err(|_| format!("party {i} failed to receive message"))?;
                        wants_msg[i] = false;
                    } else {
                        break;
                    }
                }
                match parties[i].proceed() {
                    ProceedResult::SendMsg(outgoing) => match outgoing.recipient {
                        MessageDestination::AllParties => {
                            for j in 0..n {
                                if j != i {
                                    queues[j].push_back(Incoming {
                                        id: next_id,
                                        sender: i as u16,
                                        msg_type: MessageType::Broadcast,
                                        msg: outgoing.msg.clone(),
                                    });
                                    next_id += 1;
                                }
                            }
                        }
                        MessageDestination::OneParty(dest) => {
                            queues[dest as usize].push_back(Incoming {
                                id: next_id,
                                sender: i as u16,
                                msg_type: MessageType::P2P,
                                msg: outgoing.msg,
                            });
                            next_id += 1;
                        }
                    },
                    ProceedResult::NeedsOneMoreMessage => {
                        wants_msg[i] = true;
                    }
                    ProceedResult::Output(o) => {
                        outputs[i] = Some(o);
                        done += 1;
                        break;
                    }
                    ProceedResult::Yielded => {}
                    ProceedResult::Error(e) => {
                        return Err(format!("party {i} protocol error: {e}"));
                    }
                }
            }
        }
        if done == n {
            break;
        }
    }

    if done < n {
        return Err(format!("protocol did not complete: {done}/{n} parties finished"));
    }

    outputs
        .into_iter()
        .enumerate()
        .map(|(i, o)| o.ok_or_else(|| format!("party {i} missing output")))
        .collect()
}

// ---------------------------------------------------------------------------
// DKG output types (JSON)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct DkgOutput {
    shares: Vec<DkgShare>,
    /// hex-encoded compressed public key (33 bytes)
    public_key: String,
}

#[derive(Serialize)]
struct DkgShare {
    /// base64-encoded serialized CoreKeyShare
    core_share: String,
    /// base64-encoded serialized AuxInfo
    aux_info: String,
}

// ---------------------------------------------------------------------------
// Full DKG (generates primes inline — slow)
// ---------------------------------------------------------------------------

fn run_dkg(n: u16, threshold: u16, eid_bytes: &[u8]) -> Result<DkgOutput, String> {
    let mut primes_list = Vec::new();
    let prime_start = std::time::Instant::now();
    for i in 0..n {
        let primes: cggmp24::PregeneratedPrimes<SecurityLevel128> =
            cggmp24::PregeneratedPrimes::generate(&mut OsRng);
        eprintln!("  party {i}: primes generated in {:.1}s", prime_start.elapsed().as_secs_f64());
        primes_list.push(primes);
    }
    run_dkg_inner(n, threshold, eid_bytes, primes_list)
}

// ---------------------------------------------------------------------------
// DKG with pre-generated primes (fast — skips prime generation)
// ---------------------------------------------------------------------------

fn run_dkg_with_primes(n: u16, threshold: u16, eid_bytes: &[u8], prime_lines: &[String]) -> Result<DkgOutput, String> {
    let b64 = base64::engine::general_purpose::STANDARD;
    if prime_lines.len() < n as usize {
        return Err(format!("Need {} prime sets, got {}", n, prime_lines.len()));
    }
    let mut primes_list = Vec::new();
    for (i, line) in prime_lines.iter().take(n as usize).enumerate() {
        let bytes = b64.decode(line.trim()).map_err(|e| format!("decode prime {i}: {e}"))?;
        let primes: cggmp24::PregeneratedPrimes<SecurityLevel128> =
            serde_json::from_slice(&bytes).map_err(|e| format!("deserialize prime {i}: {e}"))?;
        primes_list.push(primes);
    }
    run_dkg_inner(n, threshold, eid_bytes, primes_list)
}

// ---------------------------------------------------------------------------
// DKG inner logic (shared by both modes)
// ---------------------------------------------------------------------------

fn run_dkg_inner(n: u16, threshold: u16, eid_bytes: &[u8], primes_list: Vec<cggmp24::PregeneratedPrimes<SecurityLevel128>>) -> Result<DkgOutput, String> {
    let b64 = base64::engine::general_purpose::STANDARD;

    // Phase A: Auxiliary Info Generation (ZK proofs using provided primes)
    eprintln!("Phase A: aux_info_gen ({n} parties)...");
    let phase_a_start = std::time::Instant::now();

    let mut aux_parties = Vec::new();
    for (i, primes) in primes_list.into_iter().enumerate() {
        let i = i as u16;
        let eid = cggmp24::ExecutionId::new(eid_bytes);
        aux_parties.push(round_based::state_machine::wrap_protocol(
            move |party| async move {
                let mut rng = OsRng;
                cggmp24::aux_info_gen(eid, i, n, primes)
                    .start(&mut rng, party)
                    .await
            },
        ));
    }

    let aux_results = simulate(aux_parties).map_err(|e| format!("aux_info_gen failed: {e}"))?;
    let mut aux_infos = Vec::new();
    for (i, result) in aux_results.into_iter().enumerate() {
        let aux = result.map_err(|e| format!("aux_info_gen party {i}: {e:?}"))?;
        aux_infos.push(aux);
    }
    eprintln!("Phase A complete in {:.1}s", phase_a_start.elapsed().as_secs_f64());

    // Phase B: Key Generation (lightweight)
    eprintln!("Phase B: keygen ({n} parties, threshold {threshold})...");
    let phase_b_start = std::time::Instant::now();

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

    let kg_results = simulate(kg_parties).map_err(|e| format!("keygen failed: {e}"))?;
    let mut core_shares = Vec::new();
    for (i, result) in kg_results.into_iter().enumerate() {
        let share = result.map_err(|e| format!("keygen party {i}: {e:?}"))?;
        core_shares.push(share);
    }
    eprintln!("Phase B complete in {:.1}s", phase_b_start.elapsed().as_secs_f64());

    // Extract public key
    let pk = core_shares[0].shared_public_key();
    let pk_bytes = pk.to_bytes(true);
    let pk_hex = hex::encode(pk_bytes.as_bytes());

    // Serialize shares
    let mut shares = Vec::new();
    for i in 0..n as usize {
        let core_bytes = serde_json::to_vec(&core_shares[i])
            .map_err(|e| format!("serialize core share {i}: {e}"))?;
        let aux_bytes = serde_json::to_vec(&aux_infos[i])
            .map_err(|e| format!("serialize aux info {i}: {e}"))?;
        shares.push(DkgShare {
            core_share: b64.encode(&core_bytes),
            aux_info: b64.encode(&aux_bytes),
        });
    }

    Ok(DkgOutput {
        shares,
        public_key: pk_hex,
    })
}

// ---------------------------------------------------------------------------
// Prime generation (original mode)
// ---------------------------------------------------------------------------

fn gen_primes(count: usize) {
    let b64 = base64::engine::general_purpose::STANDARD;
    for i in 0..count {
        let start = std::time::Instant::now();
        let primes: cggmp24::PregeneratedPrimes<SecurityLevel128> =
            cggmp24::PregeneratedPrimes::generate(&mut OsRng);
        let bytes = serde_json::to_vec(&primes).expect("serialize primes");
        eprintln!(
            "prime {}/{}: {:.1}s ({} bytes)",
            i + 1,
            count,
            start.elapsed().as_secs_f64(),
            bytes.len()
        );
        println!("{}", b64.encode(&bytes));
    }
}

// ---------------------------------------------------------------------------
// AuxInfo generation (pre-generate Phase A for fast DKG)
// ---------------------------------------------------------------------------

/// JSON output from `gen-aux` — serialized AuxInfo for each party
#[derive(Serialize, Deserialize)]
struct AuxInfoOutput {
    /// base64-encoded serialized AuxInfo, one per party
    aux_infos: Vec<String>,
    n: u16,
}

/// Run only Phase A (aux_info_gen) and output serialized AuxInfo.
/// This is the expensive part of DKG. Pre-generating it makes DKG ~1s.
fn gen_aux_info(n: u16) -> Result<AuxInfoOutput, String> {
    let b64 = base64::engine::general_purpose::STANDARD;

    // Generate primes (expensive but unavoidable for fresh aux_info)
    eprintln!("Generating primes for {n} parties...");
    let mut primes_list = Vec::new();
    let prime_start = std::time::Instant::now();
    for i in 0..n {
        let primes: cggmp24::PregeneratedPrimes<SecurityLevel128> =
            cggmp24::PregeneratedPrimes::generate(&mut OsRng);
        eprintln!("  party {i}: primes in {:.1}s", prime_start.elapsed().as_secs_f64());
        primes_list.push(primes);
    }

    // Generate a random EID for this aux_info generation
    let mut eid_bytes = [0u8; 32];
    getrandom::getrandom(&mut eid_bytes).expect("getrandom");

    // Run Phase A: aux_info_gen
    eprintln!("Phase A: aux_info_gen ({n} parties)...");
    let phase_a_start = std::time::Instant::now();

    let mut aux_parties = Vec::new();
    for (i, primes) in primes_list.into_iter().enumerate() {
        let i = i as u16;
        let eid = cggmp24::ExecutionId::new(&eid_bytes);
        aux_parties.push(round_based::state_machine::wrap_protocol(
            move |party| async move {
                let mut rng = OsRng;
                cggmp24::aux_info_gen(eid, i, n, primes)
                    .start(&mut rng, party)
                    .await
            },
        ));
    }

    let aux_results = simulate(aux_parties).map_err(|e| format!("aux_info_gen failed: {e}"))?;
    let mut aux_info_b64s = Vec::new();
    for (i, result) in aux_results.into_iter().enumerate() {
        let aux = result.map_err(|e| format!("aux_info_gen party {i}: {e:?}"))?;
        let bytes = serde_json::to_vec(&aux)
            .map_err(|e| format!("serialize aux info {i}: {e}"))?;
        aux_info_b64s.push(b64.encode(&bytes));
    }
    eprintln!("Phase A complete in {:.1}s", phase_a_start.elapsed().as_secs_f64());

    Ok(AuxInfoOutput { aux_infos: aux_info_b64s, n })
}

/// Run DKG using pre-generated AuxInfo — only runs Phase B (keygen), ~1s.
fn run_dkg_with_aux(n: u16, threshold: u16, eid_bytes: &[u8], aux_info_json: &str) -> Result<DkgOutput, String> {
    let b64 = base64::engine::general_purpose::STANDARD;

    // Deserialize cached AuxInfo
    let aux_output: AuxInfoOutput = serde_json::from_str(aux_info_json)
        .map_err(|e| format!("parse cached aux info: {e}"))?;
    if (aux_output.n as usize) < n as usize || aux_output.aux_infos.len() < n as usize {
        return Err(format!("Need {} aux_infos, got {}", n, aux_output.aux_infos.len()));
    }

    let mut aux_infos = Vec::new();
    for (i, b64_str) in aux_output.aux_infos.iter().take(n as usize).enumerate() {
        let bytes = b64.decode(b64_str).map_err(|e| format!("decode aux info {i}: {e}"))?;
        let aux: cggmp24::key_share::AuxInfo<SecurityLevel128> =
            serde_json::from_slice(&bytes).map_err(|e| format!("deserialize aux info {i}: {e}"))?;
        aux_infos.push(aux);
    }

    // Phase B only: Key Generation (lightweight, ~1s)
    eprintln!("Phase B: keygen ({n} parties, threshold {threshold})...");
    let phase_b_start = std::time::Instant::now();

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

    let kg_results = simulate(kg_parties).map_err(|e| format!("keygen failed: {e}"))?;
    let mut core_shares = Vec::new();
    for (i, result) in kg_results.into_iter().enumerate() {
        let share = result.map_err(|e| format!("keygen party {i}: {e:?}"))?;
        core_shares.push(share);
    }
    eprintln!("Phase B complete in {:.1}s", phase_b_start.elapsed().as_secs_f64());

    // Extract public key
    let pk = core_shares[0].shared_public_key();
    let pk_bytes = pk.to_bytes(true);
    let pk_hex = hex::encode(pk_bytes.as_bytes());

    // Serialize shares (combine core_share + cached aux_info)
    let mut shares = Vec::new();
    for i in 0..n as usize {
        let core_bytes = serde_json::to_vec(&core_shares[i])
            .map_err(|e| format!("serialize core share {i}: {e}"))?;
        shares.push(DkgShare {
            core_share: b64.encode(&core_bytes),
            aux_info: aux_output.aux_infos[i].clone(),
        });
    }

    Ok(DkgOutput {
        shares,
        public_key: pk_hex,
    })
}

// ---------------------------------------------------------------------------
// Interactive signing types (wire-compatible with WASM WasmSignMessage)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct SignInit {
    core_share: String,         // base64
    aux_info: String,           // base64
    message_hash: String,       // hex, 32 bytes
    party_index: u16,
    parties_at_keygen: Vec<u16>,
    eid: String,                // hex, 32 bytes
}

#[derive(Serialize, Deserialize, Clone)]
struct WasmSignMessage {
    sender: u16,
    is_broadcast: bool,
    recipient: Option<u16>,
    payload: String,            // base64-encoded serde_json of protocol Msg
}

#[derive(Serialize)]
struct SignOutput {
    messages: Vec<WasmSignMessage>,
    complete: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    r: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    s: Option<String>,
}

// ---------------------------------------------------------------------------
// Interactive signing — one process per session, stdin/stdout JSON lines
// ---------------------------------------------------------------------------

fn run_interactive_sign() {
    let b64 = base64::engine::general_purpose::STANDARD;

    // Read init line from stdin
    let stdin = std::io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    let stdout = std::io::stdout();
    let mut writer = BufWriter::new(stdout.lock());

    let mut init_line = String::new();
    reader.read_line(&mut init_line).expect("failed to read init line from stdin");
    let init: SignInit = serde_json::from_str(init_line.trim())
        .expect("failed to parse sign init JSON");

    // Decode key material
    let core_bytes = b64.decode(&init.core_share).expect("decode core_share base64");
    let aux_bytes = b64.decode(&init.aux_info).expect("decode aux_info base64");
    let hash_bytes = hex::decode(&init.message_hash).expect("decode message_hash hex");
    let eid_bytes = hex::decode(&init.eid).expect("decode eid hex");

    if hash_bytes.len() != 32 {
        eprintln!("message_hash must be 32 bytes, got {}", hash_bytes.len());
        std::process::exit(1);
    }

    // Deserialize key share
    let core_share: cggmp24::IncompleteKeyShare<Secp256k1> =
        serde_json::from_slice(&core_bytes).expect("deserialize CoreKeyShare");
    let aux_info: cggmp24::key_share::AuxInfo<SecurityLevel128> =
        serde_json::from_slice(&aux_bytes).expect("deserialize AuxInfo");
    let key_share = cggmp24::KeyShare::from_parts((core_share, aux_info))
        .expect("combine key share from parts");

    // Leak for 'static lifetime — process exits after signing, so leak is harmless
    let key_share_ptr = Box::into_raw(Box::new(key_share));
    let key_share_ref: &'static cggmp24::KeyShare<Secp256k1, SecurityLevel128> =
        unsafe { &*key_share_ptr };

    // Build prehashed data to sign
    let scalar = Scalar::<Secp256k1>::from_be_bytes_mod_order(&hash_bytes);
    let prehashed_ptr = Box::into_raw(Box::new(
        cggmp24::signing::PrehashedDataToSign::from_scalar(scalar),
    ));
    let prehashed_ref: &'static cggmp24::signing::PrehashedDataToSign<Secp256k1> =
        unsafe { &*prehashed_ptr };

    // EID and parties — leak for 'static
    let eid_static: &'static [u8] = Box::leak(eid_bytes.into_boxed_slice());
    let eid = cggmp24::ExecutionId::new(eid_static);
    let parties_static: &'static [u16] = Box::leak(init.parties_at_keygen.into_boxed_slice());

    let rng_ptr = Box::into_raw(Box::new(OsRng));
    let rng_ref: &'static mut OsRng = unsafe { &mut *rng_ptr };

    // Map party_index (keygen index) → position within the parties array.
    // The cggmp24 crate expects `i` to be the 0-based position, not the
    // keygen party index. For parties=[0,1] the two are identical, but for
    // parties=[1,2] keygen index 2 is at position 1.
    let party_position = parties_static
        .iter()
        .position(|&p| p == init.party_index)
        .expect(&format!(
            "party_index {} not found in parties {:?}",
            init.party_index, parties_static
        )) as u16;

    // Create the signing state machine (GMP-accelerated)
    let sm = cggmp24::signing(eid, party_position, parties_static, key_share_ref)
        .enforce_reliable_broadcast(true)
        .sign_sync(rng_ref, prehashed_ref);

    let start = std::time::Instant::now();
    eprintln!("[native-sign] session created for party {}", init.party_index);

    run_sign_loop(sm, init.party_index, &mut reader, &mut writer);

    eprintln!("[native-sign] complete in {:.1}s", start.elapsed().as_secs_f64());
}

/// Drive the signing state machine via stdin/stdout JSON lines.
///
/// Matches the WASM `process_round` behavior: after each incoming message
/// delivery, immediately drive the state machine to collect any outgoing
/// messages before accepting the next incoming message. This is required
/// for reliable broadcast echo steps.
fn run_sign_loop<SM, R, W>(mut sm: SM, party_index: u16, reader: &mut R, writer: &mut W)
where
    SM: StateMachine<
        Output = Result<cggmp24::signing::Signature<Secp256k1>, cggmp24::signing::SigningError>,
    >,
    SM::Msg: Serialize + for<'de> Deserialize<'de> + Clone,
    R: BufRead,
    W: Write,
{
    let b64 = base64::engine::general_purpose::STANDARD;

    /// Helper: drive sm until it blocks, collecting messages and checking for completion.
    fn drive_batch<SM2>(
        sm: &mut SM2,
        party_index: u16,
        b64: &base64::engine::general_purpose::GeneralPurpose,
        messages: &mut Vec<WasmSignMessage>,
    ) -> Option<(String, String)>
    where
        SM2: StateMachine<
            Output = Result<cggmp24::signing::Signature<Secp256k1>, cggmp24::signing::SigningError>,
        >,
        SM2::Msg: Serialize,
    {
        loop {
            match sm.proceed() {
                ProceedResult::SendMsg(outgoing) => {
                    let json_bytes = serde_json::to_vec(&outgoing.msg)
                        .expect("serialize outgoing protocol message");
                    let payload = b64.encode(&json_bytes);
                    let (is_broadcast, recipient) = match outgoing.recipient {
                        MessageDestination::AllParties => (true, None),
                        MessageDestination::OneParty(p) => (false, Some(p)),
                    };
                    messages.push(WasmSignMessage {
                        sender: party_index,
                        is_broadcast,
                        recipient,
                        payload,
                    });
                }
                ProceedResult::NeedsOneMoreMessage => return None,
                ProceedResult::Output(result) => {
                    let sig = result.expect("signing protocol produced an error");
                    let sig = sig.normalize_s();
                    let mut sig_bytes =
                        vec![0u8; cggmp24::signing::Signature::<Secp256k1>::serialized_len()];
                    sig.write_to_slice(&mut sig_bytes);
                    return Some((hex::encode(&sig_bytes[..32]), hex::encode(&sig_bytes[32..])));
                }
                ProceedResult::Yielded => {} // continue
                ProceedResult::Error(e) => {
                    eprintln!("[native-sign] protocol error: {e}");
                    std::process::exit(1);
                }
            }
        }
    }

    // Phase 1: Initial drive — produce first messages
    let mut messages = Vec::new();
    let mut sig = drive_batch(&mut sm, party_index, &b64, &mut messages);

    // Output first messages
    let output = SignOutput {
        messages,
        complete: sig.is_some(),
        r: sig.as_ref().map(|(r, _)| r.clone()),
        s: sig.as_ref().map(|(_, s)| s.clone()),
    };
    let json = serde_json::to_string(&output).expect("serialize sign output");
    writeln!(writer, "{}", json).expect("write to stdout");
    writer.flush().expect("flush stdout");

    if sig.is_some() {
        return;
    }

    // Phase 2: Round loop — read incoming, deliver + drive after each, output
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).expect("read incoming messages from stdin");
        let incoming: Vec<WasmSignMessage> = serde_json::from_str(line.trim())
            .expect("parse incoming messages JSON");

        let mut all_outgoing = Vec::new();

        // Deliver each message, driving after each (matches WASM process_round)
        for msg in &incoming {
            let payload_bytes = b64
                .decode(msg.payload.as_bytes())
                .expect("base64 decode incoming message payload");
            let protocol_msg: SM::Msg = serde_json::from_slice(&payload_bytes)
                .expect("deserialize incoming protocol message");

            let incoming_msg = Incoming {
                id: 0,
                sender: msg.sender,
                msg_type: if msg.is_broadcast {
                    MessageType::Broadcast
                } else {
                    MessageType::P2P
                },
                msg: protocol_msg,
            };

            if sm.received_msg(incoming_msg).is_err() {
                eprintln!("[native-sign] failed to deliver msg from party {} (broadcast={})",
                    msg.sender, msg.is_broadcast);
                std::process::exit(1);
            }

            // Drive after each delivery to process relay/echo steps
            sig = drive_batch(&mut sm, party_index, &b64, &mut all_outgoing);
            if sig.is_some() {
                break;
            }
        }

        // Output this round's results
        let output = SignOutput {
            messages: all_outgoing,
            complete: sig.is_some(),
            r: sig.as_ref().map(|(r, _)| r.clone()),
            s: sig.as_ref().map(|(_, s)| s.clone()),
        };
        let json = serde_json::to_string(&output).expect("serialize sign output");
        writeln!(writer, "{}", json).expect("write to stdout");
        writer.flush().expect("flush stdout");

        if sig.is_some() {
            break;
        }
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn main() {
    let args: Vec<String> = std::env::args().collect();

    match args.get(1).map(|s| s.as_str()) {
        Some("dkg") => {
            let n: u16 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(3);
            let threshold: u16 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(2);
            let eid_hex = args.get(4).cloned().unwrap_or_else(|| {
                let mut eid = [0u8; 32];
                getrandom::getrandom(&mut eid).expect("getrandom");
                hex::encode(eid)
            });
            let eid_bytes = hex::decode(&eid_hex).expect("invalid eid hex");

            let start = std::time::Instant::now();
            match run_dkg(n, threshold, &eid_bytes) {
                Ok(output) => {
                    eprintln!("DKG complete in {:.1}s", start.elapsed().as_secs_f64());
                    println!("{}", serde_json::to_string(&output).expect("serialize output"));
                }
                Err(e) => {
                    eprintln!("DKG failed: {e}");
                    std::process::exit(1);
                }
            }
        }
        Some("dkg-with-primes") => {
            // Fast DKG: reads pre-generated primes from stdin (one base64 line per party)
            let n: u16 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(3);
            let threshold: u16 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(2);
            let eid_hex = args.get(4).cloned().unwrap_or_else(|| {
                let mut eid = [0u8; 32];
                getrandom::getrandom(&mut eid).expect("getrandom");
                hex::encode(eid)
            });
            let eid_bytes = hex::decode(&eid_hex).expect("invalid eid hex");

            // Read primes from stdin
            let mut input = String::new();
            std::io::Read::read_to_string(&mut std::io::stdin(), &mut input)
                .expect("failed to read stdin");
            let prime_lines: Vec<String> = input
                .lines()
                .filter(|l| !l.trim().is_empty())
                .map(|l| l.to_string())
                .collect();

            eprintln!("Read {} prime sets from stdin", prime_lines.len());

            let start = std::time::Instant::now();
            match run_dkg_with_primes(n, threshold, &eid_bytes, &prime_lines) {
                Ok(output) => {
                    eprintln!("DKG complete in {:.1}s", start.elapsed().as_secs_f64());
                    println!("{}", serde_json::to_string(&output).expect("serialize output"));
                }
                Err(e) => {
                    eprintln!("DKG failed: {e}");
                    std::process::exit(1);
                }
            }
        }
        Some("sign") => {
            run_interactive_sign();
        }
        Some("primes") => {
            let count: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(3);
            gen_primes(count);
        }
        Some("gen-aux") => {
            // Pre-generate AuxInfo (Phase A only) for fast DKG later.
            // Output: one JSON line per set to stdout.
            let n: u16 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(3);
            let count: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(1);
            for i in 0..count {
                let start = std::time::Instant::now();
                match gen_aux_info(n) {
                    Ok(output) => {
                        eprintln!("AuxInfo set {}/{} complete in {:.1}s",
                            i + 1, count, start.elapsed().as_secs_f64());
                        println!("{}", serde_json::to_string(&output).expect("serialize aux info output"));
                    }
                    Err(e) => {
                        eprintln!("AuxInfo generation failed: {e}");
                        std::process::exit(1);
                    }
                }
            }
        }
        Some("dkg-with-aux") => {
            // Fast DKG: reads pre-generated AuxInfo from stdin (one JSON line),
            // runs only Phase B (keygen) — ~1s.
            let n: u16 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(3);
            let threshold: u16 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(2);
            let eid_hex = args.get(4).cloned().unwrap_or_else(|| {
                let mut eid = [0u8; 32];
                getrandom::getrandom(&mut eid).expect("getrandom");
                hex::encode(eid)
            });
            let eid_bytes = hex::decode(&eid_hex).expect("invalid eid hex");

            // Read one line of AuxInfo JSON from stdin
            let mut input = String::new();
            std::io::Read::read_to_string(&mut std::io::stdin(), &mut input)
                .expect("failed to read stdin");
            let aux_line = input.lines().find(|l| !l.trim().is_empty())
                .expect("no aux info line on stdin");

            let start = std::time::Instant::now();
            match run_dkg_with_aux(n, threshold, &eid_bytes, aux_line) {
                Ok(output) => {
                    eprintln!("DKG (keygen only) complete in {:.1}s", start.elapsed().as_secs_f64());
                    println!("{}", serde_json::to_string(&output).expect("serialize output"));
                }
                Err(e) => {
                    eprintln!("DKG failed: {e}");
                    std::process::exit(1);
                }
            }
        }
        _ => {
            // Default: backward compatible — generate primes
            let count: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(3);
            gen_primes(count);
        }
    }
}
