import chalk from 'chalk';
import { Command, type Command as CommandType } from 'commander';
import ora from 'ora';
import { type SignerConfig, loadSignerConfig, saveSignerConfig } from '../../lib/config.js';
import { brand, dim, success, warn } from '../theme.js';

// ---------------------------------------------------------------------------
// gw network list — show available networks from server
// ---------------------------------------------------------------------------

const listCommand = new Command('list')
	.description('Show available networks')
	.action(async (_opts: unknown, command: CommandType) => {
		const spinner = ora({ text: 'Loading configuration…', indent: 2 }).start();

		let config: SignerConfig | undefined;
		try {
			config = loadSignerConfig(command.optsWithGlobals().signer);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			spinner.fail(message);
			process.exitCode = 1;
			return;
		}

		spinner.text = 'Fetching networks…';

		try {
			const url = `${config.serverUrl.replace(/\/+$/, '')}/api/v1/networks`;
			const response = await fetch(url, {
				headers: { 'x-api-key': config.apiKey },
				signal: AbortSignal.timeout(10_000),
			});

			if (!response.ok) {
				throw new Error(`Server returned ${response.status}`);
			}

			const networks = (await response.json()) as {
				name: string;
				displayName: string;
				chainId: number;
				nativeCurrency: string;
				isTestnet: boolean;
				enabled: boolean;
			}[];

			spinner.stop();

			console.log('');
			console.log(`  ${chalk.bold('Available Networks')}`);
			console.log(`  ${dim('Networks supported by your Guardian server.')}`);
			console.log('');

			const current = config.network;

			for (const net of networks) {
				const isCurrent = net.name === current;
				const marker = isCurrent ? success(' ●') : '  ';
				const tag = net.isTestnet ? dim(' (testnet)') : '';
				const currentLabel = isCurrent ? success(' ← default') : '';

				console.log(
					`${marker} ${chalk.bold(net.name.padEnd(20))} ${dim(`chain ${net.chainId}`).padEnd(24)} ${net.nativeCurrency}${tag}${currentLabel}`,
				);
			}

			console.log('');
			if (!current) {
				console.log(
					`  ${warn('No default network set.')} Run ${chalk.bold('gw network set <name>')} to pick one.`,
				);
				console.log('');
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			spinner.fail(`Failed to fetch networks: ${message}`);
			process.exitCode = 1;
		}
	});

// ---------------------------------------------------------------------------
// gw network set <name> — save default network to signer config
// ---------------------------------------------------------------------------

const setCommand = new Command('set')
	.description('Set the default network for an account')
	.argument('<network>', 'Network name (e.g. base-sepolia, ethereum)')
	.action(async (networkName: string, _opts: unknown, command: CommandType) => {
		const spinner = ora({ text: 'Loading configuration…', indent: 2 }).start();

		let config: SignerConfig | undefined;
		let signerName: string;
		try {
			signerName = command.optsWithGlobals().signer;
			config = loadSignerConfig(signerName);
			signerName = config.signerName;
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			spinner.fail(message);
			process.exitCode = 1;
			return;
		}

		// Validate against server
		spinner.text = 'Validating network…';

		try {
			const url = `${config.serverUrl.replace(/\/+$/, '')}/api/v1/networks`;
			const response = await fetch(url, {
				headers: { 'x-api-key': config.apiKey },
				signal: AbortSignal.timeout(10_000),
			});

			if (response.ok) {
				const networks = (await response.json()) as { name: string }[];
				const valid = networks.some((n) => n.name === networkName);
				if (!valid) {
					spinner.fail(
						`Unknown network "${networkName}". Run ${chalk.bold('gw network list')} to see available networks.`,
					);
					process.exitCode = 1;
					return;
				}
			}
			// If server unreachable, save anyway — user knows what they're doing
		} catch {
			// Server validation is best-effort
		}

		const previous = config.network;
		config.network = networkName;
		saveSignerConfig(signerName, config);

		if (previous) {
			spinner.succeed(`Default network changed: ${dim(previous)} → ${brand(networkName)}`);
		} else {
			spinner.succeed(`Default network set to ${brand(networkName)}`);
		}
	});

// ---------------------------------------------------------------------------
// gw network get — show current default network
// ---------------------------------------------------------------------------

const getCommand = new Command('get')
	.description('Show the current default network for an account')
	.action(async (_opts: unknown, command: CommandType) => {
		let config: SignerConfig | undefined;
		try {
			config = loadSignerConfig(command.optsWithGlobals().signer);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			console.error(`  ${message}`);
			process.exitCode = 1;
			return;
		}

		console.log('');
		if (config.network) {
			console.log(`  Default network: ${brand(config.network)}`);
			console.log(
				`  ${dim('Used by gw balance, gw send, and other commands when --network is omitted.')}`,
			);
		} else {
			console.log(`  ${warn('No default network set.')}`);
			console.log(`  ${dim('Commands will require --network <name> until you set one.')}`);
			console.log(`  ${dim(`Run ${chalk.bold('gw network set <name>')} to pick a default.`)}`);
		}
		console.log('');
	});

// ---------------------------------------------------------------------------
// gw network info <name> — show details for a specific network
// ---------------------------------------------------------------------------

const infoCommand = new Command('info')
	.description('Show details for a specific network')
	.argument('<network>', 'Network name (e.g. base-sepolia)')
	.action(async (networkName: string, _opts: unknown, command: CommandType) => {
		const spinner = ora({ text: 'Loading configuration…', indent: 2 }).start();

		let config: SignerConfig | undefined;
		try {
			config = loadSignerConfig(command.optsWithGlobals().signer);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			spinner.fail(message);
			process.exitCode = 1;
			return;
		}

		spinner.text = 'Fetching network info…';

		try {
			const url = `${config.serverUrl.replace(/\/+$/, '')}/api/v1/networks`;
			const response = await fetch(url, {
				headers: { 'x-api-key': config.apiKey },
				signal: AbortSignal.timeout(10_000),
			});

			if (!response.ok) {
				throw new Error(`Server returned ${response.status}`);
			}

			const networks = (await response.json()) as {
				name: string;
				displayName: string;
				chainId: number;
				rpcUrl: string;
				explorerUrl: string;
				nativeCurrency: string;
				isTestnet: boolean;
				enabled: boolean;
			}[];

			const net = networks.find((n) => n.name === networkName);
			if (!net) {
				spinner.fail(
					`Unknown network "${networkName}". Run ${chalk.bold('gw network list')} to see available networks.`,
				);
				process.exitCode = 1;
				return;
			}

			spinner.stop();

			const isCurrent = config.network === net.name;

			console.log('');
			console.log(`  ${chalk.bold(net.displayName)}`);
			console.log('');
			console.log(`  Name:       ${brand(net.name)}${isCurrent ? success(' ← default') : ''}`);
			console.log(`  Chain ID:   ${net.chainId}`);
			console.log(`  Currency:   ${net.nativeCurrency}`);
			console.log(`  Type:       ${net.isTestnet ? warn('testnet') : success('mainnet')}`);
			console.log(`  Explorer:   ${dim(net.explorerUrl || 'none')}`);
			console.log('');
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			spinner.fail(`Failed to fetch network info: ${message}`);
			process.exitCode = 1;
		}
	});

// ---------------------------------------------------------------------------
// Main command group
// ---------------------------------------------------------------------------

export const networkCommand = new Command('network')
	.description('Manage networks — list available chains, set your default')
	.addCommand(listCommand)
	.addCommand(setCommand)
	.addCommand(getCommand)
	.addCommand(infoCommand)
	.action(() => {
		// Default action: show list
		listCommand.parse(process.argv);
	});
