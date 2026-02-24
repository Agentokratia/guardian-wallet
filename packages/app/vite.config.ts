import path from 'node:path';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';

// The WASM glue code (wasm-pack) emits `import * from "env"` for host
// environment imports (__stack_pointer, etc.).  These are provided at
// runtime by WebAssembly.instantiate() and don't exist as JS modules.
// Resolve them to an empty shim so Vite's import-analysis doesn't choke.
function wasmEnvShim(): Plugin {
	const shimId = '\0wasm-env-shim';
	return {
		name: 'wasm-env-shim',
		resolveId(id) {
			if (id === 'env') return shimId;
		},
		load(id) {
			if (id === shimId) return 'export default {};';
		},
	};
}

export default defineConfig({
	plugins: [react(), wasmEnvShim()],
	envDir: path.resolve(__dirname, '../..'),
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
			// Use the browser (web) build of the WASM module — the default export
			// points to the Node.js build which uses require('fs') and __dirname.
			'@agentokratia/guardian-mpc-wasm': path.resolve(
				__dirname,
				'../mpc-wasm/pkg-web/guardian_mpc_wasm.js',
			),
		},
	},
	optimizeDeps: {
		exclude: ['@agentokratia/guardian-mpc-wasm'],
	},
	build: {
		rollupOptions: {
			external: [
				'env', // WASM host import (provided by WebAssembly runtime)
			],
			output: {
				manualChunks: {
					'vendor-react': ['react', 'react-dom', 'react-router-dom'],
					'vendor-ui': [
						'@radix-ui/react-dialog',
						'@radix-ui/react-select',
						'@radix-ui/react-tabs',
						'@radix-ui/react-tooltip',
						'@radix-ui/react-toast',
						'@radix-ui/react-scroll-area',
						'@radix-ui/react-switch',
						'@radix-ui/react-separator',
						'@radix-ui/react-slot',
					],
					'vendor-icons': ['lucide-react'],
					'vendor-query': ['@tanstack/react-query'],
					'vendor-viem': ['viem'],
				},
			},
		},
	},
	server: {
		port: 3000,
		proxy: {
			'/api': {
				target: 'http://localhost:8080',
				changeOrigin: true,
				timeout: 180_000, // DKG cold start takes ~120s
			},
			'/health': {
				target: 'http://localhost:8080',
				changeOrigin: true,
			},
		},
	},
});
