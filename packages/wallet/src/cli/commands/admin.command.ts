import { createHash } from 'node:crypto';
import { confirm, input, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { Command, type Command as CommandType } from 'commander';
import ora from 'ora';
import { formatEther, parseEther } from 'viem';
import {
	type SignerConfig,
	deleteAdminToken,
	loadAdminToken,
	loadSignerConfig,
	saveAdminToken,
} from '../../lib/config.js';
import { getUserShare } from '../../lib/keychain.js';
import { brand, danger, dim, failMark, promptTheme, success, warn } from '../theme.js';

// ---------------------------------------------------------------------------
// Error handler (clean output, no stack traces)
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: commander action callbacks use any[]
function withErrorHandler(
	fn: (...args: any[]) => Promise<void>,
): (...args: any[]) => Promise<void> {
	// biome-ignore lint/suspicious/noExplicitAny: commander action callbacks use any[]
	return async (...args: any[]) => {
		try {
			await fn(...args);
		} catch (error: unknown) {
			if (error instanceof Error && error.name === 'ExitPromptError') {
				console.log(dim('\n  Cancelled.\n'));
				return;
			}
			const message = error instanceof Error ? error.message : 'Unknown error';
			console.error(`\n  ${failMark(message)}\n`);
			process.exitCode = 1;
		}
	};
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminContext {
	config: SignerConfig;
	signerName: string;
	signerId: string;
	headers: Record<string, string>;
}

interface LegacyPolicy {
	id: string;
	signerId: string;
	type: string;
	config: Record<string, unknown>;
	enabled: boolean;
	appliesTo?: string[];
	timesTriggered?: number;
	createdAt?: string;
}

interface AuditEntry {
	id: string;
	signerId: string;
	requestType: string;
	signingPath: string;
	status: string;
	toAddress?: string;
	valueWei?: string;
	txHash?: string;
	policyViolations?: unknown[];
	createdAt: string;
}

// ---------------------------------------------------------------------------
// TTL parsing
// ---------------------------------------------------------------------------

function parseTtlSeconds(ttl: string): number {
	const match = ttl.match(/^(\d+)\s*(s|m|h|d)$/);
	if (!match) throw new Error('Invalid TTL format. Use e.g. 30m, 8h, 1d.');
	const n = Number.parseInt(match[1] ?? '0', 10);
	const unit = match[2] ?? 's';
	const multiplier = { s: 1, m: 60, h: 3600, d: 86_400 }[unit] ?? 1;
	return n * multiplier;
}

async function exchangeForJwt(
	serverUrl: string,
	signerId: string,
	hash: string,
	ttlSeconds?: number,
): Promise<{ token: string; expiresIn: number }> {
	const url = `${serverUrl.replace(/\/+$/, '')}/api/v1/auth/admin-token`;
	const body: Record<string, unknown> = { signerId, adminToken: hash };
	if (ttlSeconds) body.ttl = ttlSeconds;

	const response = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(15_000),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Failed to get admin token: ${response.status} ${text}`);
	}

	return response.json() as Promise<{ token: string; expiresIn: number }>;
}

// ---------------------------------------------------------------------------
// Auth resolution
// ---------------------------------------------------------------------------

async function getAdminContext(command: CommandType): Promise<AdminContext> {
	const signerName = command.optsWithGlobals().signer;
	const config = loadSignerConfig(signerName);

	if (!config.signerId) {
		throw new Error('No signer ID in config. Re-run `gw init` or add signerId to config.');
	}

	const headers: Record<string, string> = {
		'x-api-key': config.apiKey,
		'x-signer-id': config.signerId,
		'content-type': 'application/json',
	};

	// Admin token file (JWT issued by `gw admin unlock`)
	const result = loadAdminToken(config.signerName);

	switch (result.status) {
		case 'valid':
			headers['x-admin-token'] = result.token.token;
			return { config, signerName: config.signerName, signerId: config.signerId, headers };
		case 'expired':
			throw new Error(
				`Admin token expired. Run ${chalk.bold('gw admin unlock')} to re-authenticate.`,
			);
		case 'corrupt':
			throw new Error(
				`Admin token file is corrupt. Run ${chalk.bold('gw admin unlock')} to get a new one.`,
			);
		case 'missing':
			throw new Error(`Not unlocked. Run ${chalk.bold('gw admin unlock')} first.`);
	}
}

function getAuditContext(command: CommandType): {
	config: SignerConfig;
	headers: Record<string, string>;
} {
	const signerName = command.optsWithGlobals().signer;
	const config = loadSignerConfig(signerName);
	return {
		config,
		headers: {
			'x-api-key': config.apiKey,
			'content-type': 'application/json',
		},
	};
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function adminFetch<T>(
	baseUrl: string,
	path: string,
	headers: Record<string, string>,
	method = 'GET',
	body?: unknown,
): Promise<T> {
	const url = `${baseUrl.replace(/\/+$/, '')}/api/v1${path}`;
	const response = await fetch(url, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(30_000),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Server returned ${response.status}: ${text}`);
	}

	if (response.status === 204) return undefined as T;
	return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Visual helpers
// ---------------------------------------------------------------------------

function fmtAddr(address: string): string {
	if (!address || address.length < 10) return dim('—');
	return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function fmtId(id: string): string {
	return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function fmtConfig(type: string, config: Record<string, unknown>): string {
	switch (type) {
		case 'spending_limit': {
			const wei = config.maxAmount as string;
			return `max: ${formatWei(wei)} ETH`;
		}
		case 'daily_limit': {
			const wei = config.maxDailyAmount as string;
			return `max/day: ${formatWei(wei)} ETH`;
		}
		case 'monthly_limit': {
			const wei = config.maxMonthlyAmount as string;
			return `max/month: ${formatWei(wei)} ETH`;
		}
		case 'rate_limit':
			return `${config.maxRequests} req / ${config.windowSeconds}s`;
		case 'allowed_contracts': {
			const addrs = (config.addresses as string[]) || [];
			return addrs.map(fmtAddr).join(', ');
		}
		case 'allowed_functions': {
			const sels = (config.selectors as string[]) || [];
			return sels.join(', ');
		}
		case 'blocked_addresses': {
			const addrs = (config.addresses as string[]) || [];
			return addrs.map(fmtAddr).join(', ');
		}
		case 'time_window':
			return `${config.startHour}:00–${config.endHour}:00 ${config.timezone || 'UTC'}`;
		default:
			return JSON.stringify(config);
	}
}

function formatWei(weiStr: string | undefined): string {
	if (!weiStr || weiStr === '0') return '0';
	try {
		return formatEther(BigInt(weiStr));
	} catch {
		return weiStr;
	}
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping is intentional
const ANSI_RE = /\u001B\[[0-9;]*m/g;

function pad(str: string, width: number): string {
	const visible = str.replace(ANSI_RE, '');
	return str + ' '.repeat(Math.max(0, width - visible.length));
}

// ---------------------------------------------------------------------------
// Policy config builders (interactive)
// ---------------------------------------------------------------------------

type PolicyConfig = Record<string, unknown>;

const POLICY_TYPES = [
	'spending_limit',
	'daily_limit',
	'monthly_limit',
	'allowed_contracts',
	'allowed_functions',
	'blocked_addresses',
	'rate_limit',
	'time_window',
] as const;

async function buildPolicyConfigInteractive(type: string): Promise<PolicyConfig> {
	switch (type) {
		case 'spending_limit': {
			const max = await input({ message: 'Max amount (ETH)', theme: promptTheme });
			return { maxAmount: parseEther(max).toString() };
		}
		case 'daily_limit': {
			const max = await input({ message: 'Max daily amount (ETH)', theme: promptTheme });
			return { maxDailyAmount: parseEther(max).toString() };
		}
		case 'monthly_limit': {
			const max = await input({ message: 'Max monthly amount (ETH)', theme: promptTheme });
			return { maxMonthlyAmount: parseEther(max).toString() };
		}
		case 'allowed_contracts': {
			const addrs = await input({
				message: 'Contract addresses (comma-separated)',
				theme: promptTheme,
			});
			return {
				addresses: addrs
					.split(',')
					.map((a) => a.trim())
					.filter(Boolean),
			};
		}
		case 'allowed_functions': {
			const sigs = await input({
				message: 'Function selectors (comma-separated)',
				theme: promptTheme,
			});
			return {
				selectors: sigs
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean),
			};
		}
		case 'blocked_addresses': {
			const addrs = await input({
				message: 'Blocked addresses (comma-separated)',
				theme: promptTheme,
			});
			return {
				addresses: addrs
					.split(',')
					.map((a) => a.trim())
					.filter(Boolean),
			};
		}
		case 'rate_limit': {
			const max = await input({ message: 'Max requests', theme: promptTheme });
			const window = await input({ message: 'Window (seconds)', theme: promptTheme });
			return { maxRequests: Number.parseInt(max, 10), windowSeconds: Number.parseInt(window, 10) };
		}
		case 'time_window': {
			const start = await input({ message: 'Start hour (0-23)', theme: promptTheme });
			const end = await input({ message: 'End hour (0-23)', theme: promptTheme });
			const tz = await input({ message: 'Timezone', default: 'UTC', theme: promptTheme });
			return {
				startHour: Number.parseInt(start, 10),
				endHour: Number.parseInt(end, 10),
				timezone: tz,
			};
		}
		default:
			throw new Error(`Unknown policy type: ${type}`);
	}
}

function buildPolicyConfigFromFlags(
	type: string,
	opts: Record<string, string | undefined>,
): PolicyConfig {
	switch (type) {
		case 'spending_limit': {
			if (!opts.max) throw new Error('--max <eth> is required for spending_limit');
			return { maxAmount: parseEther(opts.max).toString() };
		}
		case 'daily_limit': {
			if (!opts.max) throw new Error('--max <eth> is required for daily_limit');
			return { maxDailyAmount: parseEther(opts.max).toString() };
		}
		case 'monthly_limit': {
			if (!opts.max) throw new Error('--max <eth> is required for monthly_limit');
			return { maxMonthlyAmount: parseEther(opts.max).toString() };
		}
		case 'allowed_contracts': {
			if (!opts.addresses) throw new Error('--addresses <addrs> is required for allowed_contracts');
			return {
				addresses: opts.addresses
					.split(',')
					.map((a) => a.trim())
					.filter(Boolean),
			};
		}
		case 'allowed_functions': {
			if (!opts.selectors) throw new Error('--selectors <sigs> is required for allowed_functions');
			return {
				selectors: opts.selectors
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean),
			};
		}
		case 'blocked_addresses': {
			if (!opts.addresses) throw new Error('--addresses <addrs> is required for blocked_addresses');
			return {
				addresses: opts.addresses
					.split(',')
					.map((a) => a.trim())
					.filter(Boolean),
			};
		}
		case 'rate_limit': {
			if (!opts.maxRequests || !opts.window)
				throw new Error('--max-requests <n> and --window <secs> are required for rate_limit');
			return {
				maxRequests: Number.parseInt(opts.maxRequests, 10),
				windowSeconds: Number.parseInt(opts.window, 10),
			};
		}
		case 'time_window': {
			if (!opts.start || !opts.end)
				throw new Error('--start <h> and --end <h> are required for time_window');
			return {
				startHour: Number.parseInt(opts.start, 10),
				endHour: Number.parseInt(opts.end, 10),
				timezone: opts.timezone || 'UTC',
			};
		}
		default:
			throw new Error(`Unknown policy type: ${type}`);
	}
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

const unlockCommand = new Command('unlock')
	.description('Enable admin access (reads recovery key from keychain)')
	.option('--ttl <duration>', 'Token expiry (e.g. 30m, 8h, 1d)', '5m')
	.action(
		withErrorHandler(async (opts: { ttl: string }, command: CommandType) => {
			const signerName = command.optsWithGlobals().signer;
			const config = loadSignerConfig(signerName);

			if (!config.signerId) {
				throw new Error('No signer ID in config. Re-run `gw init` or add signerId to config.');
			}

			const spinner = ora({ text: 'Reading recovery key from keychain…', indent: 2 }).start();

			const userShare = await getUserShare(config.signerName);
			if (!userShare) {
				spinner.fail('No recovery key found in keychain');
				console.error(dim('\n  Was this wallet created via `gw init`?\n'));
				process.exitCode = 1;
				return;
			}

			spinner.text = 'Exchanging for admin token…';

			const hash = createHash('sha256').update(userShare).digest('hex');
			const ttlSeconds = parseTtlSeconds(opts.ttl);
			const { token, expiresIn } = await exchangeForJwt(
				config.serverUrl,
				config.signerId,
				hash,
				ttlSeconds,
			);

			const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
			saveAdminToken(config.signerName, {
				token,
				createdAt: new Date().toISOString(),
				expiresAt,
			});

			spinner.succeed(`Admin access enabled for "${config.signerName}" (expires: ${opts.ttl})`);
			console.log('');
		}),
	);

const lockCommand = new Command('lock').description('Revoke admin access (deletes token)').action(
	withErrorHandler(async (_opts: unknown, command: CommandType) => {
		const signerName = command.optsWithGlobals().signer;
		const config = loadSignerConfig(signerName);

		const deleted = deleteAdminToken(config.signerName);
		if (deleted) {
			console.log(`\n  ${success('✓')} Admin access revoked for "${config.signerName}"\n`);
		} else {
			console.log(`\n  ${dim('No admin token found for')} "${config.signerName}"\n`);
		}
	}),
);

// -- Policies ----------------------------------------------------------------

async function handlePoliciesList(command: CommandType): Promise<void> {
	const ctx = await getAdminContext(command);
	const spinner = ora({ text: 'Fetching policies…', indent: 2 }).start();

	const policies = await adminFetch<LegacyPolicy[]>(
		ctx.config.serverUrl,
		`/signers/${ctx.signerId}/policies`,
		ctx.headers,
	);

	spinner.stop();

	console.log('');
	console.log(
		`  Policies for ${chalk.bold(ctx.signerName)} ${dim(`(${fmtAddr(ctx.config.ethAddress)})`)}`,
	);
	console.log('');

	if (policies.length === 0) {
		console.log(dim('  No policies configured.'));
		console.log(dim(`  Run ${chalk.reset('gw admin policies add')} to create one.`));
	} else {
		const tw = 18;
		const cw = 34;

		console.log(
			`  ${pad(dim('ID'), 10)}  ${pad(dim('Type'), tw)}  ${pad(dim('Config'), cw)}  ${dim('Enabled')}`,
		);
		console.log(dim(`  ${'─'.repeat(10)}  ${'─'.repeat(tw)}  ${'─'.repeat(cw)}  ${'─'.repeat(7)}`));

		for (const p of policies) {
			const id = fmtId(p.id);
			const type = pad(p.type, tw);
			const cfg = pad(fmtConfig(p.type, p.config), cw);
			const enabled = p.enabled ? success('Yes') : dim('No');
			console.log(`  ${pad(id, 10)}  ${type}  ${cfg}  ${enabled}`);
		}

		const enabledCount = policies.filter((p) => p.enabled).length;
		console.log('');
		console.log(dim(`  ${policies.length} policies (${enabledCount} enabled)`));
	}
	console.log('');
}

const policiesAddCommand = new Command('add')
	.description('Add a policy')
	.option('--type <type>', 'Policy type (non-interactive mode)')
	.option('--max <eth>', 'Max amount in ETH (spending/daily/monthly limit)')
	.option('--addresses <addrs>', 'Comma-separated addresses')
	.option('--selectors <sigs>', 'Comma-separated function selectors')
	.option('--max-requests <n>', 'Max requests (rate_limit)')
	.option('--window <secs>', 'Window in seconds (rate_limit)')
	.option('--start <hour>', 'Start hour 0-23 (time_window)')
	.option('--end <hour>', 'End hour 0-23 (time_window)')
	.option('--timezone <tz>', 'Timezone (time_window)')
	.action(
		withErrorHandler(async (opts: Record<string, string | undefined>, command: CommandType) => {
			const ctx = await getAdminContext(command);
			let type: string;
			let config: PolicyConfig;

			if (opts.type) {
				// Non-interactive
				type = opts.type;
				if (!POLICY_TYPES.includes(type as (typeof POLICY_TYPES)[number])) {
					throw new Error(`Unknown policy type: ${type}. Valid: ${POLICY_TYPES.join(', ')}`);
				}
				config = buildPolicyConfigFromFlags(type, opts);
			} else {
				// Interactive
				type = await select({
					message: 'Policy type',
					choices: POLICY_TYPES.map((t) => ({ name: t, value: t })),
					loop: false,
					theme: promptTheme,
				});
				config = await buildPolicyConfigInteractive(type);

				console.log('');
				console.log(`  ${dim('Type:')}   ${type}`);
				console.log(`  ${dim('Config:')} ${fmtConfig(type, config)}`);
				console.log('');

				const ok = await confirm({
					message: 'Create this policy?',
					default: true,
					theme: promptTheme,
				});
				if (!ok) {
					console.log(dim('\n  Cancelled.\n'));
					return;
				}
			}

			const spinner = ora({ text: 'Creating policy…', indent: 2 }).start();

			const policy = await adminFetch<LegacyPolicy>(
				ctx.config.serverUrl,
				`/signers/${ctx.signerId}/policies`,
				ctx.headers,
				'POST',
				{ type, config, enabled: true },
			);

			spinner.succeed(`Policy created: ${dim(policy.id)}`);
			console.log('');
		}),
	);

const policiesRemoveCommand = new Command('remove')
	.description('Remove a policy')
	.argument('<id>', 'Policy ID')
	.action(
		withErrorHandler(async (idArg: string, _opts: unknown, command: CommandType) => {
			const ctx = await getAdminContext(command);

			// Fetch policy details first
			const policies = await adminFetch<LegacyPolicy[]>(
				ctx.config.serverUrl,
				`/signers/${ctx.signerId}/policies`,
				ctx.headers,
			);
			if (idArg.length < 4)
				throw new Error(
					'Policy ID must be at least 4 characters (use `gw admin policies` to list IDs).',
				);
			const matches = policies.filter((p) => p.id === idArg || p.id.startsWith(idArg));
			if (matches.length > 1)
				throw new Error(
					`Ambiguous prefix "${idArg}" matches ${matches.length} policies. Use a longer ID.`,
				);
			const policy = matches[0];
			let resolvedId = idArg;

			if (policy) {
				console.log('');
				console.log(`  ${dim('Type:')}   ${policy.type}`);
				console.log(`  ${dim('Config:')} ${fmtConfig(policy.type, policy.config)}`);
				console.log('');

				const ok = await confirm({
					message: 'Remove this policy?',
					default: false,
					theme: promptTheme,
				});
				if (!ok) {
					console.log(dim('\n  Cancelled.\n'));
					return;
				}
				resolvedId = policy.id;
			}

			const spinner = ora({ text: 'Removing policy…', indent: 2 }).start();

			await adminFetch<void>(
				ctx.config.serverUrl,
				`/policies/${resolvedId}`,
				ctx.headers,
				'DELETE',
			);

			spinner.succeed('Policy removed');
			console.log('');
		}),
	);

const policiesToggleCommand = new Command('toggle')
	.description('Enable or disable a policy')
	.argument('<id>', 'Policy ID')
	.action(
		withErrorHandler(async (idArg: string, _opts: unknown, command: CommandType) => {
			const ctx = await getAdminContext(command);

			// Fetch to find current state
			const policies = await adminFetch<LegacyPolicy[]>(
				ctx.config.serverUrl,
				`/signers/${ctx.signerId}/policies`,
				ctx.headers,
			);
			if (idArg.length < 4) throw new Error('Policy ID must be at least 4 characters.');
			const matches = policies.filter((p) => p.id === idArg || p.id.startsWith(idArg));
			if (matches.length > 1)
				throw new Error(
					`Ambiguous prefix "${idArg}" matches ${matches.length} policies. Use a longer ID.`,
				);
			const policy = matches[0];
			if (!policy) throw new Error(`Policy not found: ${idArg}`);

			const newEnabled = !policy.enabled;
			await adminFetch<LegacyPolicy>(
				ctx.config.serverUrl,
				`/policies/${policy.id}`,
				ctx.headers,
				'PATCH',
				{ enabled: newEnabled },
			);

			const label = newEnabled ? success('Enabled') : dim('Disabled');
			console.log(`\n  ${policy.type}: ${label}\n`);
		}),
	);

// -- Pause / Resume ----------------------------------------------------------

const pauseCommand = new Command('pause').description('Pause wallet (blocks all signing)').action(
	withErrorHandler(async (_opts: unknown, command: CommandType) => {
		const ctx = await getAdminContext(command);

		console.log('');
		console.log(
			`  Pause ${chalk.bold(ctx.signerName)} ${dim(`(${fmtAddr(ctx.config.ethAddress)})`)}`,
		);
		console.log(warn('  This will block ALL signing requests until resumed.'));
		console.log('');

		const ok = await confirm({ message: 'Confirm pause?', default: false, theme: promptTheme });
		if (!ok) {
			console.log(dim('\n  Cancelled.\n'));
			return;
		}

		const spinner = ora({ text: 'Pausing…', indent: 2 }).start();
		await adminFetch<unknown>(
			ctx.config.serverUrl,
			`/signers/${ctx.signerId}/pause`,
			ctx.headers,
			'POST',
		);
		spinner.succeed('Wallet paused');
		console.log('');
	}),
);

const resumeCommand = new Command('resume')
	.description('Resume wallet (re-enables signing)')
	.action(
		withErrorHandler(async (_opts: unknown, command: CommandType) => {
			const ctx = await getAdminContext(command);

			const ok = await confirm({
				message: `Resume "${ctx.signerName}"?`,
				default: true,
				theme: promptTheme,
			});
			if (!ok) {
				console.log(dim('\n  Cancelled.\n'));
				return;
			}

			const spinner = ora({ text: 'Resuming…', indent: 2 }).start();
			await adminFetch<unknown>(
				ctx.config.serverUrl,
				`/signers/${ctx.signerId}/resume`,
				ctx.headers,
				'POST',
			);
			spinner.succeed('Wallet resumed');
			console.log('');
		}),
	);

// -- Audit -------------------------------------------------------------------

const auditCommand = new Command('audit')
	.description('View signing request audit log')
	.option('--limit <n>', 'Number of entries', '20')
	.option('--status <status>', 'Filter: completed, blocked, failed, pending')
	.option('--export', 'Output CSV to stdout')
	.action(
		withErrorHandler(
			async (opts: { limit: string; status?: string; export?: boolean }, command: CommandType) => {
				// Audit uses API key auth only — no admin token needed
				const { config } = getAuditContext(command);
				const signerId = config.signerId;

				if (!signerId) {
					throw new Error('No signer ID in config.');
				}

				const params = new URLSearchParams();
				params.set('signerId', signerId);
				params.set('limit', opts.limit);
				if (opts.status) params.set('status', opts.status);

				const baseUrl = config.serverUrl.replace(/\/+$/, '');
				const headers: Record<string, string> = { 'x-api-key': config.apiKey };

				if (opts.export) {
					const url = `${baseUrl}/api/v1/audit-log/export?${params}`;
					const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
					if (!response.ok) throw new Error(`Server returned ${response.status}`);
					const csv = await response.text();
					process.stdout.write(csv);
					return;
				}

				const spinner = ora({ text: 'Fetching audit log…', indent: 2 }).start();
				const url = `${baseUrl}/api/v1/audit-log?${params}`;
				const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
				if (!response.ok) throw new Error(`Server returned ${response.status}`);

				const data = (await response.json()) as { entries?: AuditEntry[]; data?: AuditEntry[] };
				const entries = data.entries || data.data || [];

				spinner.stop();

				console.log('');
				console.log(`  Audit log for ${chalk.bold(config.signerName)}`);
				console.log('');

				if (entries.length === 0) {
					console.log(dim('  No entries found.'));
				} else {
					const tw = 12;
					const pw = 14;
					const sw = 10;
					const aw = 14;

					console.log(
						`  ${pad(dim('Time'), 19)}  ${pad(dim('Type'), tw)}  ${pad(dim('Path'), pw)}  ${pad(dim('Status'), sw)}  ${pad(dim('To'), aw)}  ${dim('Value')}`,
					);
					console.log(
						dim(
							`  ${'─'.repeat(19)}  ${'─'.repeat(tw)}  ${'─'.repeat(pw)}  ${'─'.repeat(sw)}  ${'─'.repeat(aw)}  ${'─'.repeat(10)}`,
						),
					);

					for (const e of entries) {
						const time = new Date(e.createdAt).toISOString().replace('T', ' ').slice(0, 19);
						const type = pad(e.requestType || '—', tw);
						const path = pad(e.signingPath || '—', pw);
						const statusFn =
							e.status === 'completed' ? success : e.status === 'blocked' ? danger : warn;
						const status = pad(statusFn(e.status), sw);
						const to = pad(e.toAddress ? fmtAddr(e.toAddress) : '—', aw);
						const value = e.valueWei ? `${formatWei(e.valueWei)} ETH` : '—';

						console.log(`  ${time}  ${type}  ${path}  ${status}  ${to}  ${value}`);
					}

					console.log('');
					console.log(
						dim(`  ${entries.length} entries. Use --limit to see more, --export for CSV.`),
					);
				}
				console.log('');
			},
		),
	);

// ---------------------------------------------------------------------------
// Main command group
// ---------------------------------------------------------------------------

const policiesCommand = new Command('policies').description('Manage signing policies').action(
	withErrorHandler(async (_opts: unknown, command: CommandType) => {
		await handlePoliciesList(command);
	}),
);

policiesCommand.addCommand(policiesAddCommand);
policiesCommand.addCommand(policiesRemoveCommand);
policiesCommand.addCommand(policiesToggleCommand);

export const adminCommand = new Command('admin')
	.description('Admin operations (policies, pause/resume, audit)')
	.addCommand(unlockCommand)
	.addCommand(lockCommand)
	.addCommand(policiesCommand)
	.addCommand(pauseCommand)
	.addCommand(resumeCommand)
	.addCommand(auditCommand);
