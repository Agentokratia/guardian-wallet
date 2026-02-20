import { existsSync } from 'node:fs';
import { input, password, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import {
	type SignerConfig,
	createClientFromConfig,
	getDefaultSignerName,
	getSignerConfigPath,
	listSigners,
	loadSignerConfig,
	saveSignerConfig,
	setDefaultSigner,
	validateSignerName,
} from '../../lib/config.js';
import { isKeychainAvailable, storeUserShare } from '../../lib/keychain.js';
import {
	BRAND_BANNER,
	brand,
	brandBold,
	brandDot,
	dim,
	failMark,
	hint,
	promptTheme,
	section,
	success,
	successMark,
} from '../theme.js';

interface PublicCreateResponse {
	signerId: string;
	ethAddress: string;
	apiKey: string;
	signerShare: string;
	userShare: string;
}

// ---------------------------------------------------------------------------
// Visual helpers
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping is intentional
const ANSI_RE = /\u001B\[[0-9;]*m/g;

function pad(str: string, width: number): string {
	const visible = str.replace(ANSI_RE, '');
	return str + ' '.repeat(Math.max(0, width - visible.length));
}

function fmtAddr(address: string): string {
	if (!address || address.length < 10) return dim('—');
	return dim(`${address.slice(0, 6)}…${address.slice(-4)}`);
}

function walletCard(name: string, address: string, extra?: string): void {
	console.log('');
	console.log(`  ${brand('●')} ${brandBold(name)}`);
	console.log(`    ${dim(address)}`);
	if (extra) console.log(`    ${dim(extra)}`);
}

function step(icon: string, text: string): void {
	console.log(`  ${icon} ${text}`);
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const initCommand = new Command('init')
	.description('Set up your Guardian Wallet')
	.action(async () => {
		console.log(BRAND_BANNER);

		try {
			const existing = listSigners();
			const defaultName = getDefaultSignerName();

			const choices: { name: string; value: string; description: string }[] = [
				{
					name: 'Create a new wallet',
					value: 'create',
					description: 'Get started — takes about 10 seconds',
				},
				{
					name: 'I already have a wallet',
					value: 'import',
					description: 'Connect using an API key and secret file',
				},
			];
			if (existing.length > 1) {
				choices.push({
					name: 'Switch active wallet',
					value: 'switch',
					description: `Current: ${defaultName ?? 'none'}`,
				});
			}

			const choice = await select({
				message: 'What would you like to do?',
				choices,
				loop: false,
				theme: promptTheme,
			});

			switch (choice) {
				case 'create':
					await handleCreate();
					break;
				case 'import':
					await handleImport();
					break;
				case 'switch':
					await handleSwitch();
					break;
			}
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

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

async function handleCreate(): Promise<void> {
	// ── 1. Basics ─────────────────────────────────────────────────────────
	section('Basics');

	const name = await input({
		message: 'Wallet name',
		theme: promptTheme,
		validate: (v) => {
			const err = validateSignerName(v);
			if (err) return err;
			if (existsSync(getSignerConfigPath(v)))
				return `"${v}" already exists. Pick a different name.`;
			return true;
		},
	});

	console.log('');

	const serverUrl = await input({
		message: 'Policy engine URL',
		default: 'http://localhost:8080',
		theme: promptTheme,
	});

	// ── 2. Security ───────────────────────────────────────────────────────
	section('Security');
	hint('Your recovery key lets you manage policies and sign without the server.');

	const keychainOk = await isKeychainAvailable();
	let storage: 'keychain' | 'file' = 'file';

	if (keychainOk) {
		console.log('');
		storage = await select<'keychain' | 'file'>({
			message: 'Recovery key storage',
			choices: [
				{
					name: 'System keychain (recommended)',
					value: 'keychain',
					description: 'Encrypted by your OS, Touch ID protected',
				},
				{
					name: 'Local file',
					value: 'file',
					description: `Saved in ${getSignerConfigPath(name).replace(/\.json$/, '.user-share')}`,
				},
			],
			loop: false,
			theme: promptTheme,
		});
	} else {
		hint('System keychain not available — recovery key will be saved as a local file.');
	}

	// ── 3. Generate ───────────────────────────────────────────────────────
	section('Creating wallet');
	hint('Running distributed key generation — this takes a few seconds.');
	console.log('');
	const spinner = ora({ text: 'Generating wallet…', indent: 2 }).start();

	const url = `${serverUrl.replace(/\/+$/, '')}/api/v1/signers/public`;
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name }),
		signal: AbortSignal.timeout(120_000),
	});

	if (!response.ok) {
		const text = await response.text();
		spinner.fail('Failed');
		throw new Error(`Server returned ${response.status}: ${text}`);
	}

	const result = (await response.json()) as PublicCreateResponse;
	spinner.succeed('Wallet created');

	// ── Save everything ───────────────────────────────────────────────────
	// Store user share FIRST — if this fails, we haven't written config yet.
	// Once config is saved, the signer is "registered" locally.
	await storeUserShare(name, result.userShare, storage);

	const config: SignerConfig = {
		version: 1,
		serverUrl,
		apiKey: result.apiKey,
		apiSecret: result.signerShare,
		signerName: name,
		ethAddress: result.ethAddress,
		signerId: result.signerId,
		createdAt: new Date().toISOString(),
	};
	saveSignerConfig(name, config);
	setDefaultSigner(name);

	// ── Summary ───────────────────────────────────────────────────────────
	walletCard(name, result.ethAddress, `API key: ${result.apiKey.slice(0, 16)}…`);

	console.log('');
	step(
		successMark(
			storage === 'keychain' ? 'Recovery key → system keychain' : 'Recovery key → local file',
		),
		'',
	);
	step(successMark('Set as active wallet'), '');

	console.log('');
	console.log(`  ${dim(`Config: ${getSignerConfigPath(name)}`)}`);
	console.log('');
	console.log(`  ${success('Done!')} Run ${chalk.bold('gw status')} to see your wallets.`);
	console.log(`         Run ${chalk.bold('gw admin unlock')} to manage policies.`);
	console.log('');
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

async function handleImport(): Promise<void> {
	// ── 1. Basics ─────────────────────────────────────────────────────────
	section('Basics');

	const name = await input({
		message: 'Wallet name',
		theme: promptTheme,
		validate: (v) => {
			const err = validateSignerName(v);
			if (err) return err;
			if (existsSync(getSignerConfigPath(v)))
				return `"${v}" already exists. Pick a different name.`;
			return true;
		},
	});

	console.log('');

	const serverUrl = await input({
		message: 'Policy engine URL',
		default: 'http://localhost:8080',
		theme: promptTheme,
	});

	// ── 2. Credentials ───────────────────────────────────────────────────
	section('Credentials');
	hint('Find your API key and secret in the Guardian dashboard.');
	console.log('');

	const apiKey = await password({
		message: 'API key',
		mask: '*',
		theme: promptTheme,
	});
	if (!apiKey) throw new Error('API key is required.');

	console.log('');

	const secretSource = await select({
		message: 'Signer secret',
		choices: [
			{
				name: 'Point to a file on disk',
				value: 'file',
				description: 'e.g. ~/Downloads/my-wallet.secret',
			},
			{
				name: 'Paste the contents directly',
				value: 'paste',
				description: 'Copy from the dashboard',
			},
		],
		theme: promptTheme,
	});

	console.log('');

	let apiSecret: string | undefined;
	let apiSecretFile: string | undefined;

	if (secretSource === 'file') {
		apiSecretFile = await input({ message: 'Path to secret file', theme: promptTheme });
	} else {
		apiSecret = await password({ message: 'Paste secret contents', mask: '*', theme: promptTheme });
	}

	if (!apiSecret && !apiSecretFile) {
		throw new Error('A secret file or value is required.');
	}

	// ── 3. Connect ────────────────────────────────────────────────────────
	section('Connecting');
	const spinner = ora({ text: 'Verifying with server…', indent: 2 }).start();
	let signerId: string | undefined;
	let ethAddress = '';

	try {
		const { api } = createClientFromConfig({ serverUrl, apiKey });
		const signers = await api.listSigners();
		const [s] = signers;
		if (s) {
			signerId = s.id;
			ethAddress = s.ethAddress;
			spinner.succeed('Connected');
		} else {
			spinner.warn('Connected — no wallet found for this API key');
		}
	} catch {
		spinner.warn('Server unreachable — config saved, you can connect later');
	}

	const config: SignerConfig = {
		version: 1,
		serverUrl,
		apiKey,
		apiSecret,
		apiSecretFile,
		signerName: name,
		ethAddress,
		signerId,
		createdAt: new Date().toISOString(),
	};
	saveSignerConfig(name, config);
	setDefaultSigner(name);

	if (ethAddress) {
		walletCard(name, ethAddress);
	}

	console.log('');
	step(successMark('Config saved'), '');
	step(successMark('Set as active wallet'), '');

	console.log('');
	console.log(`  ${dim(`Config: ${getSignerConfigPath(name)}`)}`);
	console.log('');
	console.log(`  ${success('Done!')} Run ${chalk.bold('gw status')} to see your wallets.`);
	console.log('');
}

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

async function handleSwitch(): Promise<void> {
	const current = listSigners();
	if (current.length === 0) {
		console.log(chalk.yellow('\n  No wallets found. Create one first.\n'));
		return;
	}

	const defaultName = getDefaultSignerName();
	const nw = Math.max(4, ...current.map((n) => n.length)) + 3;

	const choices = current.map((name) => {
		const isCurrent = name === defaultName;
		let addr = '';
		try {
			const config = loadSignerConfig(name);
			if (config.ethAddress) addr = fmtAddr(config.ethAddress);
		} catch {
			// ignore
		}

		const dot = brandDot(isCurrent);
		const label = isCurrent ? brandBold(name) : name;
		const tag = isCurrent ? dim(' (current)') : '';

		return {
			name: `${dot} ${pad(label, nw)} ${addr}${tag}`,
			value: name,
		};
	});

	const selected = await select({
		message: 'Switch to',
		choices,
		default: defaultName ?? undefined,
		loop: false,
		theme: promptTheme,
	});

	setDefaultSigner(selected);
	console.log('');
	step(successMark(`${chalk.bold(selected)} is now active`), '');
	console.log('');
}
