//! Native binary to generate Paillier primes fast.
//!
//! Runs natively (~100x faster than WASM) and outputs serialized primes
//! as newline-delimited base64 strings to stdout.
//!
//! Usage: gen_primes [count]   (default: 3)

use cggmp24::security_level::SecurityLevel128;
use rand::rngs::OsRng;
use base64::Engine;

fn main() {
    let count: usize = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(3);

    for i in 0..count {
        let start = std::time::Instant::now();
        let primes: cggmp24::PregeneratedPrimes<SecurityLevel128> =
            cggmp24::PregeneratedPrimes::generate(&mut OsRng);
        let bytes = serde_json::to_vec(&primes).expect("serialize primes");
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        eprintln!("prime {}/{}: {:.1}s ({} bytes)", i + 1, count, start.elapsed().as_secs_f64(), bytes.len());
        println!("{b64}");
    }
}
