//! Local MPC protocol simulation.
//!
//! Runs multiple state machines (parties) locally with automatic message routing.
//! Used for DKG where all parties run on the server.
//!
//! Based on the `SimulationSync` pattern from `round-based` but without
//! the `dev` feature dependency (which pulls in tokio, problematic for WASM).

use std::collections::VecDeque;

use round_based::state_machine::{ProceedResult, StateMachine};
use round_based::{Incoming, MessageDestination, MessageType};

/// Run a protocol simulation with all parties locally.
///
/// All parties must be the same concrete state machine type (same protocol).
/// Messages are automatically routed between parties.
///
/// Returns one output per party, or an error if the protocol fails.
pub fn run<S>(mut parties: Vec<S>) -> Result<Vec<S::Output>, String>
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

    // Bounded iteration to prevent infinite loops in case of protocol bugs
    for _ in 0..100_000 {
        for i in 0..n {
            if outputs[i].is_some() {
                continue;
            }

            loop {
                // If the party wants a message, try to deliver one
                if wants_msg[i] {
                    if let Some(msg) = queues[i].pop_front() {
                        parties[i]
                            .received_msg(msg)
                            .map_err(|_| format!("party {i} failed to receive message"))?;
                        wants_msg[i] = false;
                    } else {
                        // No messages available, skip to next party
                        break;
                    }
                }

                match parties[i].proceed() {
                    ProceedResult::SendMsg(outgoing) => {
                        match outgoing.recipient {
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
                        }
                        // Continue processing this party
                    }
                    ProceedResult::NeedsOneMoreMessage => {
                        wants_msg[i] = true;
                        // Loop back to try delivering a message
                    }
                    ProceedResult::Output(o) => {
                        outputs[i] = Some(o);
                        done += 1;
                        break;
                    }
                    ProceedResult::Yielded => {
                        // Continue processing this party
                    }
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
        return Err(format!(
            "protocol did not complete: {done}/{n} parties finished"
        ));
    }

    outputs
        .into_iter()
        .enumerate()
        .map(|(i, o)| o.ok_or_else(|| format!("party {i} missing output")))
        .collect()
}
