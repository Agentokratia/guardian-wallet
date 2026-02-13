import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { ThresholdSigner } from '@agentokratia/guardian-signer';
import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { loadConfig } from '../config.js';
import { createSignerFromConfig } from '../signer-factory.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
	readonly jsonrpc: '2.0';
	readonly method: string;
	readonly params?: readonly unknown[];
	readonly id: number | string | null;
}

interface JsonRpcResponse {
	readonly jsonrpc: '2.0';
	readonly id: number | string | null;
	readonly result?: unknown;
	readonly error?: {
		readonly code: number;
		readonly message: string;
		readonly data?: unknown;
	};
}

interface ServerNetwork {
	readonly name: string;
	readonly displayName: string;
	readonly chainId: number;
	readonly rpcUrl: string;
	readonly explorerUrl: string | null;
	readonly nativeCurrency: string;
	readonly isTestnet: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Methods that require threshold signing. */
const SIGNING_METHODS = new Set([
	'eth_sendTransaction',
	'eth_signTransaction',
	'eth_sign',
	'personal_sign',
]);

/** Methods that should return the signer's address (enables --unlocked in Forge/Hardhat). */
const ACCOUNT_METHODS = new Set(['eth_accounts', 'eth_requestAccounts']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readRequestBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', (chunk: Buffer) => chunks.push(chunk));
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
		req.on('error', reject);
	});
}

function sendJsonResponse(res: ServerResponse, body: JsonRpcResponse): void {
	const json = JSON.stringify(body);
	res.writeHead(200, {
		'Content-Type': 'application/json',
		'Content-Length': Buffer.byteLength(json),
	});
	res.end(json);
}

function makeErrorResponse(
	id: number | string | null,
	code: number,
	message: string,
): JsonRpcResponse {
	return {
		jsonrpc: '2.0',
		id,
		error: { code, message },
	};
}

async function forwardToRpc(rpcUrl: string, request: JsonRpcRequest): Promise<JsonRpcResponse> {
	const response = await fetch(rpcUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(request),
		signal: AbortSignal.timeout(30_000),
	});

	if (!response.ok) {
		const text = await response.text();
		return makeErrorResponse(request.id, -32603, `RPC error: HTTP ${response.status} -- ${text}`);
	}

	return response.json() as Promise<JsonRpcResponse>;
}

/**
 * Fetch available networks from the Guardian server.
 * Returns a Map of chainId → ServerNetwork for quick lookup.
 */
async function fetchServerNetworks(
	serverUrl: string,
	apiKey: string,
): Promise<Map<number, ServerNetwork>> {
	const response = await fetch(`${serverUrl}/api/v1/networks`, {
		headers: { 'x-api-key': apiKey },
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch networks: HTTP ${response.status}`);
	}

	const networks = (await response.json()) as ServerNetwork[];
	const map = new Map<number, ServerNetwork>();
	for (const net of networks) {
		map.set(net.chainId, net);
	}
	return map;
}

async function handleSigningRequest(
	request: JsonRpcRequest,
	signer: ThresholdSigner,
): Promise<JsonRpcResponse> {
	const params = request.params;
	if (!params || !Array.isArray(params) || params.length === 0) {
		return makeErrorResponse(request.id, -32602, 'Missing transaction parameters');
	}

	try {
		if (request.method === 'eth_sendTransaction' || request.method === 'eth_signTransaction') {
			const txParams = params[0] as Record<string, unknown> | undefined;
			if (!txParams || typeof txParams !== 'object') {
				return makeErrorResponse(request.id, -32602, 'Invalid transaction parameters');
			}

			const transaction: Record<string, unknown> = {};
			if (txParams.to !== undefined) transaction.to = txParams.to;
			if (txParams.value !== undefined) transaction.value = txParams.value;
			if (txParams.data !== undefined) transaction.data = txParams.data;
			if (txParams.input !== undefined) transaction.data = txParams.input;
			if (txParams.gas !== undefined) transaction.gasLimit = txParams.gas;
			if (txParams.gasLimit !== undefined) transaction.gasLimit = txParams.gasLimit;
			// Forge/Hardhat send numeric fields as hex (e.g. "0xe"); server expects numbers/strings.
			if (txParams.nonce !== undefined) {
				const raw = txParams.nonce;
				transaction.nonce = typeof raw === 'string' ? Number.parseInt(raw, 16) : raw;
			}
			if (txParams.chainId !== undefined) {
				const raw = txParams.chainId;
				transaction.chainId = typeof raw === 'string' ? Number.parseInt(raw, 16) : raw;
			}

			const result = await signer.signTransaction(transaction);

			return {
				jsonrpc: '2.0',
				id: request.id,
				result: result.txHash,
			};
		}

		// eth_sign and personal_sign
		const message = typeof params[0] === 'string' ? params[0] : String(params[0]);
		const signResult = await signer.signMessage(message);

		return {
			jsonrpc: '2.0',
			id: request.id,
			result: signResult.signature,
		};
	} catch (error: unknown) {
		const msg = error instanceof Error ? error.message : 'Unknown error';
		return makeErrorResponse(request.id, -32603, `Signing failed: ${msg}`);
	}
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const proxyCommand = new Command('proxy')
	.description('Start a network-agnostic JSON-RPC signing proxy for Foundry/Hardhat')
	.option('-p, --port <port>', 'Port to listen on', '8545')
	.option('-r, --rpc-url <url>', 'Override upstream RPC URL (default: auto-detected from server)')
	.action(async (options: { port: string; rpcUrl?: string }) => {
		let config: ReturnType<typeof loadConfig> | undefined;
		try {
			config = loadConfig();
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			console.error(chalk.red(`\n  Error: ${message}\n`));
			process.exitCode = 1;
			return;
		}

		const port = Number.parseInt(options.port, 10);

		if (Number.isNaN(port) || port < 1 || port > 65535) {
			console.error(chalk.red('\n  Error: Port must be a number between 1 and 65535.\n'));
			process.exitCode = 1;
			return;
		}

		console.log(chalk.bold('\n  Guardian Wallet RPC Proxy'));
		console.log(chalk.dim(`  ${'-'.repeat(40)}`));

		// Fetch network config from the server (single source of truth)
		let networkMap: Map<number, ServerNetwork>;
		const networkSpinner = ora({ text: 'Fetching networks from server...', indent: 2 }).start();
		try {
			networkMap = await fetchServerNetworks(config.serverUrl, config.apiKey);
			networkSpinner.succeed(`Loaded ${networkMap.size} networks from server`);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			networkSpinner.fail(`Failed to fetch networks: ${message}`);
			process.exitCode = 1;
			return;
		}

		// Resolve RPC URL: --rpc-url flag > server network matching config.network
		let rpcUrl: string;
		let networkName: string;
		if (options.rpcUrl) {
			rpcUrl = options.rpcUrl;
			networkName = config.network;
			console.log(chalk.dim(`  Network: ${networkName} (RPC override)`));
		} else {
			// Find the network by name from server's list
			let matched: ServerNetwork | undefined;
			for (const net of networkMap.values()) {
				if (net.name === config.network) {
					matched = net;
					break;
				}
			}
			if (!matched) {
				console.error(
					chalk.red(`\n  Error: Network "${config.network}" not found on server.`),
				);
				console.error(
					chalk.dim(`  Available: ${[...networkMap.values()].map((n) => n.name).join(', ')}\n`),
				);
				process.exitCode = 1;
				return;
			}
			rpcUrl = matched.rpcUrl;
			networkName = matched.displayName;
			console.log(`  Network: ${networkName} (chainId: ${matched.chainId})`);
		}
		console.log(`  RPC:     ${rpcUrl}`);
		console.log('');

		const spinner = ora({ text: 'Loading keyshare...', indent: 2 }).start();

		let signer: ThresholdSigner;
		try {
			signer = await createSignerFromConfig(config);
			spinner.succeed(`Keyshare loaded (address: ${signer.address})`);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			spinner.fail(`Failed to load keyshare: ${message}`);
			process.exitCode = 1;
			return;
		}

		let requestCount = 0;

		const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
			// CORS headers for browser-based tools
			res.setHeader('Access-Control-Allow-Origin', '*');
			res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
			res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

			if (req.method === 'OPTIONS') {
				res.writeHead(204);
				res.end();
				return;
			}

			if (req.method !== 'POST') {
				res.writeHead(405, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'Method not allowed' }));
				return;
			}

			try {
				const body = await readRequestBody(req);
				let rpcRequest: JsonRpcRequest;

				try {
					rpcRequest = JSON.parse(body) as JsonRpcRequest;
				} catch {
					sendJsonResponse(res, makeErrorResponse(null, -32700, 'Parse error'));
					return;
				}

				requestCount++;
				const reqNum = requestCount;
				const method = rpcRequest.method;

				if (ACCOUNT_METHODS.has(method)) {
					console.log(chalk.dim(`  #${reqNum} ${method} -> [${signer.address}]`));
					sendJsonResponse(res, {
						jsonrpc: '2.0',
						id: rpcRequest.id,
						result: [signer.address],
					});
				} else if (SIGNING_METHODS.has(method)) {
					console.log(
						chalk.yellow(`  #${reqNum}`) + chalk.dim(` ${method} `) + chalk.yellow('(signing)'),
					);

					const response = await handleSigningRequest(rpcRequest, signer);
					sendJsonResponse(res, response);

					if (response.error) {
						console.log(chalk.red(`  #${reqNum} error: ${response.error.message}`));
					} else {
						console.log(chalk.green(`  #${reqNum} done`));
					}
				} else {
					console.log(chalk.dim(`  #${reqNum} ${method} -> RPC`));

					const response = await forwardToRpc(rpcUrl, rpcRequest);
					sendJsonResponse(res, response);
				}
			} catch (error: unknown) {
				const msg = error instanceof Error ? error.message : 'Unknown error';
				sendJsonResponse(res, makeErrorResponse(null, -32603, msg));
			}
		});

		// Handle graceful shutdown — wipe share from memory
		const shutdown = (): void => {
			console.log(chalk.dim('\n  Shutting down proxy...'));
			try {
				signer.destroy();
				console.log(chalk.dim('  Share wiped from memory.'));
			} catch {
				// ignore destroy errors
			}
			server.close(() => {
				console.log(chalk.dim('  Proxy stopped.\n'));
				process.exit(0);
			});
		};

		process.on('SIGINT', shutdown);
		process.on('SIGTERM', shutdown);

		server.listen(port, () => {
			console.log('');
			console.log(chalk.green('  Proxy running on ') + chalk.bold(`http://localhost:${port}`));
			console.log('');
			console.log(chalk.dim('  Usage with Foundry:'));
			console.log(chalk.dim(`    forge script Script.s.sol --rpc-url http://localhost:${port}`));
			console.log(chalk.dim('  Usage with cast:'));
			console.log(chalk.dim(`    cast send <to> --rpc-url http://localhost:${port}`));
			console.log('');
			console.log(chalk.dim('  Press Ctrl+C to stop.\n'));
		});
	});
