#!/bin/bash
set -euo pipefail

if command -v wasm-pack &>/dev/null; then
	wasm-pack build --target web --out-dir pkg-web --release
elif [ -f pkg-web/guardian_mpc_wasm_bg.wasm ]; then
	echo "wasm-pack not found, using existing pkg-web/ build"
else
	echo "ERROR: wasm-pack not found and no pre-built pkg-web/ exists"
	echo "Install wasm-pack: cargo install wasm-pack"
	exit 1
fi
