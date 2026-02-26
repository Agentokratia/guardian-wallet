import { existsSync } from 'node:fs';
import { confirm, input, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import {
	getSignerConfigPath,
	loadRecoveryMeta,
	loadSignerConfig,
	saveRecoveryMeta,
	validateSignerName,
} from '../../lib/config.js';
import {
	getSession,
	getSessionServerUrl,
	getUserShare,
	storeUserShare,
} from '../../lib/keychain.js';
import { decryptShareFromTransfer, deriveTransferKey } from '../../lib/transfer-crypto.js';
import { dim, failMark, hint, promptTheme, section, success, successMark } from '../theme.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PublicSigner {
	id: string;
	name: string;
	ethAddress: string;
	network?: string;
	status: string;
}

interface PendingTransfer {
	transferId: string;
	direction: string;
	expiresAt: string;
}

/** Fully resolved context — all fields guaranteed present after resolution. */
interface ResolvedContext {
	signerName: string;
	signerId: string;
	ethAddress: string;
	baseUrl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateAddress(addr: string): string {
	if (addr.length <= 10) return addr;
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function fetchWithAuth<T>(
	url: string,
	token: string,
	opts: { method?: string; body?: unknown } = {},
): Promise<{ ok: true; data: T } | { ok: false; status: number; text: string }> {
	const headers: Record<string, string> = { authorization: `Bearer ${token}` };
	const init: RequestInit = {
		method: opts.method ?? 'GET',
		headers,
		signal: AbortSignal.timeout(15_000),
	};
	if (opts.body !== undefined) {
		headers['content-type'] = 'application/json';
		init.body = JSON.stringify(opts.body);
	}

	let response: Response;
	try {
		response = await fetch(url, init);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return { ok: false, status: 0, text: message };
	}

	if (!response.ok) {
		const text = await response.text();
		return { ok: false, status: response.status, text };
	}

	return { ok: true, data: (await response.json()) as T };
}

// ---------------------------------------------------------------------------
// Server URL resolution (priority order)
// ---------------------------------------------------------------------------

async function resolveServerUrl(opts: {
	signerName?: string;
	cliFlag?: string;
}): Promise<string | null> {
	// 1. Local signer config (gw init was run)
	if (opts.signerName) {
		const configPath = getSignerConfigPath(opts.signerName);
		if (existsSync(configPath)) {
			try {
				const config = loadSignerConfig(opts.signerName);
				return config.serverUrl;
			} catch {
				// Config exists but is malformed — fall through
			}
		}

		// 2. Recovery metadata (previous gw receive)
		const meta = loadRecoveryMeta(opts.signerName);
		if (meta) return meta.serverUrl;
	}

	// 3. --server CLI flag
	if (opts.cliFlag) return opts.cliFlag;

	// 4. Session file (stored during gw login)
	const sessionUrl = await getSessionServerUrl();
	if (sessionUrl) return sessionUrl;

	// 5. No URL found
	return null;
}

// ---------------------------------------------------------------------------
// Context resolution — populates signerName, signerId, ethAddress, baseUrl
// ---------------------------------------------------------------------------

async function resolveContext(
	signerArg: string | undefined,
	serverFlag: string | undefined,
	token: string,
): Promise<ResolvedContext | null> {
	// Path A: Local signer config exists (gw init was run on this device)
	if (signerArg) {
		const configPath = getSignerConfigPath(signerArg);
		if (existsSync(configPath)) {
			try {
				const config = loadSignerConfig(signerArg);
				if (config.signerId) {
					return {
						signerName: signerArg,
						signerId: config.signerId,
						ethAddress: config.ethAddress,
						baseUrl: (serverFlag ?? config.serverUrl).replace(/\/+$/, ''),
					};
				}
			} catch {
				// Config malformed — fall through
			}
		}

		// Path B: Recovery metadata exists (second+ receive on same device)
		const meta = loadRecoveryMeta(signerArg);
		if (meta) {
			return {
				signerName: meta.signerName,
				signerId: meta.signerId,
				ethAddress: meta.ethAddress,
				baseUrl: (serverFlag ?? meta.serverUrl).replace(/\/+$/, ''),
			};
		}
	}

	// Path C: Server discovery (first receive on fresh device)
	return resolveFromServer(signerArg, serverFlag, token);
}

async function resolveFromServer(
	signerArg: string | undefined,
	serverFlag: string | undefined,
	token: string,
): Promise<ResolvedContext | null> {
	const resolvedUrl = await resolveServerUrl({
		signerName: signerArg,
		cliFlag: serverFlag,
	});

	let baseUrl: string;
	if (resolvedUrl) {
		baseUrl = resolvedUrl;
	} else {
		baseUrl = await input({
			message: 'Server URL',
			default: 'http://localhost:8080',
			theme: promptTheme,
		});
	}
	baseUrl = baseUrl.replace(/\/+$/, '');

	section('Receive share');
	hint('Checking for pending transfers…');
	console.log('');

	// Fetch signers from server
	const spinner = ora({ text: 'Connecting to server…', indent: 2 }).start();
	const signersResult = await fetchWithAuth<PublicSigner[]>(`${baseUrl}/api/v1/signers`, token);

	if (!signersResult.ok) {
		spinner.fail('Could not connect to server');
		if (signersResult.status === 401) {
			console.error(`\n  ${failMark(`Session expired. Run ${chalk.bold('gw login')} again.`)}\n`);
		} else if (signersResult.status === 0) {
			console.error(
				`\n  ${failMark(`Could not reach server at ${baseUrl}. Check the URL and try again.`)}\n`,
			);
		} else {
			console.error(
				`\n  ${failMark(`Server error (${signersResult.status}): ${signersResult.text}`)}\n`,
			);
		}
		return null;
	}

	spinner.succeed('Connected to server');

	const signers = signersResult.data;
	if (signers.length === 0) {
		console.log('');
		console.log(
			`  ${failMark('No accounts found. Create one in Guardian or run')} ${chalk.bold('gw init')} ${dim('on the agent device first.')}`,
		);
		console.log('');
		return null;
	}

	// Match by name or pick interactively
	let picked: PublicSigner;
	if (signerArg) {
		const match = signers.find((s) => s.name === signerArg);
		if (!match) {
			const available = signers.map((s) => s.name).join(', ');
			console.log('');
			console.log(
				`  ${failMark(`No account named "${signerArg}" found. Available: ${available}`)}`,
			);
			console.log('');
			return null;
		}
		picked = match;
	} else if (signers.length === 1) {
		picked = signers[0] as PublicSigner;
		console.log(
			`  Found 1 account: ${chalk.bold(picked.name)} (${truncateAddress(picked.ethAddress)})`,
		);
	} else {
		console.log(`  Found ${signers.length} accounts:`);
		console.log('');
		picked = await select({
			message: 'Which account do you want to receive the share for?',
			choices: signers.map((s) => ({
				name: `${s.name}    (${truncateAddress(s.ethAddress)})`,
				value: s,
			})),
			theme: promptTheme,
		});
	}

	// Validate signer name from server (defense against path traversal)
	const nameError = validateSignerName(picked.name);
	if (nameError) {
		console.error(
			`\n  ${failMark(`Invalid account name from server: "${picked.name}". ${nameError}`)}\n`,
		);
		return null;
	}

	return {
		signerName: picked.name,
		signerId: picked.id,
		ethAddress: picked.ethAddress,
		baseUrl,
	};
}

// ---------------------------------------------------------------------------
// gw receive [signer] — Receive a share from another device via 6-word code
// ---------------------------------------------------------------------------

export const receiveCommand = new Command('receive')
	.description('Receive a wallet share from another device (enter 6-word code)')
	.argument('[signer]', 'Signer name')
	.option('--server <url>', 'Server URL override')
	.action(async (signerArg: string | undefined, opts: { server?: string }) => {
		try {
			// 1. Require session
			const token = await getSession();
			if (!token) {
				console.error(`\n  ${failMark(`Not logged in. Run ${chalk.bold('gw login')} first.`)}\n`);
				process.exitCode = 1;
				return;
			}

			// 2. Resolve signer context (3 paths: local config → recovery meta → server)
			const ctx = await resolveContext(signerArg, opts.server, token);
			if (!ctx) {
				process.exitCode = 1;
				return;
			}

			const { signerName, signerId, ethAddress, baseUrl } = ctx;

			// Show section header if not already shown by server discovery (Path C)
			if (signerArg) {
				const hasLocalConfig = existsSync(getSignerConfigPath(signerArg));
				const hasRecoveryMeta = loadRecoveryMeta(signerArg) !== null;
				if (hasLocalConfig || hasRecoveryMeta) {
					section('Receive share');
					hint('Checking for pending transfers…');
					console.log('');
				}
			}

			// 3. Check if share already exists locally
			const existingShare = await getUserShare(signerName);
			if (existingShare) {
				console.log('');
				console.log(
					dim(`  This device already has a recovery key for ${chalk.reset.bold(signerName)}.`),
				);
				const overwrite = await confirm({
					message: 'Overwrite the existing recovery key?',
					default: false,
					theme: promptTheme,
				});
				if (!overwrite) {
					console.log(dim('\n  Cancelled.\n'));
					return;
				}
			}

			// 4. Check for pending transfer
			const pendingSpinner = ora({ text: 'Looking for pending transfer…', indent: 2 }).start();
			const pendingResult = await fetchWithAuth<PendingTransfer | null>(
				`${baseUrl}/api/v1/auth/transfer/pending?signerId=${signerId}`,
				token,
			);

			if (!pendingResult.ok) {
				pendingSpinner.fail('Failed to check transfers');
				if (pendingResult.status === 401) {
					console.error(
						`\n  ${failMark(`Session expired. Run ${chalk.bold('gw login')} again.`)}\n`,
					);
				} else {
					console.error(
						`\n  ${failMark(`Server returned ${pendingResult.status}: ${pendingResult.text}`)}\n`,
					);
				}
				process.exitCode = 1;
				return;
			}

			const pending = pendingResult.data;
			if (!pending || !pending.transferId) {
				pendingSpinner.info('No pending transfer found');
				console.log('');
				console.log(
					dim(`  Run ${chalk.reset(`gw link ${signerName}`)} on the source device first.`),
				);
				console.log('');
				return;
			}

			pendingSpinner.succeed('Pending transfer found');

			// 5. Prompt for 6-word code
			console.log('');
			const wordsInput = await input({
				message: 'Enter the 6-word transfer code',
				theme: promptTheme,
				validate: (v) => {
					const words = v.trim().split(/\s+/);
					if (words.length !== 6) return 'Enter exactly 6 words separated by spaces';
					return true;
				},
			});

			const words = wordsInput
				.trim()
				.split(/\s+/)
				.map((w) => w.toLowerCase());

			// 6. Derive key + claim transfer
			const claimSpinner = ora({ text: 'Claiming transfer…', indent: 2 }).start();

			let transferKey: Uint8Array;
			try {
				transferKey = deriveTransferKey(words, pending.transferId);
			} catch (err) {
				claimSpinner.fail('Invalid transfer code');
				throw err;
			}

			const claimResult = await fetchWithAuth<{ encryptedPayload: string; lockExpiresAt: string }>(
				`${baseUrl}/api/v1/auth/transfer/${pending.transferId}/claim`,
				token,
				{ method: 'POST' },
			);

			if (!claimResult.ok) {
				transferKey.fill(0);
				claimSpinner.fail('Failed to claim transfer');
				throw new Error(`Server returned ${claimResult.status}: ${claimResult.text}`);
			}

			claimSpinner.succeed('Transfer claimed');

			// 7. Decrypt share
			const decryptSpinner = ora({ text: 'Decrypting share…', indent: 2 }).start();
			let shareBytes: Uint8Array;
			try {
				shareBytes = await decryptShareFromTransfer(claimResult.data.encryptedPayload, transferKey);
			} catch {
				transferKey.fill(0);
				decryptSpinner.fail('Decryption failed — wrong transfer code');
				process.exitCode = 1;
				return;
			}
			transferKey.fill(0);
			decryptSpinner.succeed('Share decrypted');

			// 8. Store in keychain
			const storeSpinner = ora({ text: 'Storing recovery key…', indent: 2 }).start();
			const shareBase64 = Buffer.from(shareBytes).toString('base64');
			shareBytes.fill(0);
			await storeUserShare(signerName, shareBase64);
			storeSpinner.succeed('Recovery key stored');

			// 9. Confirm transfer (non-critical — share is already stored locally)
			const confirmSpinner = ora({ text: 'Confirming transfer…', indent: 2 }).start();
			try {
				const confirmResult = await fetchWithAuth<unknown>(
					`${baseUrl}/api/v1/auth/transfer/${pending.transferId}/confirm`,
					token,
					{ method: 'POST' },
				);

				if (!confirmResult.ok) {
					confirmSpinner.warn('Confirmation failed — share is still stored locally');
				} else {
					confirmSpinner.succeed('Transfer confirmed');
				}
			} catch {
				confirmSpinner.warn('Could not confirm transfer — share is still stored locally');
			}

			// 10. Save recovery metadata (so next gw receive skips server discovery)
			saveRecoveryMeta(signerName, {
				signerName,
				signerId,
				ethAddress,
				serverUrl: baseUrl,
				receivedAt: new Date().toISOString(),
			});

			console.log('');
			console.log(`  ${successMark(`Share for ${chalk.bold(signerName)} received and stored`)}`);
			console.log('');
			console.log(`  ${success('Done!')} This device now holds the recovery key.`);
			console.log(`  Run ${chalk.bold('gw admin policies')} to manage policies.`);
			console.log('');
		} catch (error: unknown) {
			if (error instanceof Error && error.name === 'ExitPromptError') {
				console.log(dim('\n  Cancelled.\n'));
				return;
			}
			const message = error instanceof Error ? error.message : 'Unknown error';
			console.error(`\n  ${failMark(message)}\n`);
			process.exitCode = 1;
		}
	});
