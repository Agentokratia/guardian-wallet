import { createHash } from 'node:crypto';
import { CRITERION_CATALOG } from '@agentokratia/guardian-core';
import { confirm, input, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { Command, type Command as CommandType } from 'commander';
import ora from 'ora';
import { formatEther } from 'viem';
import {
	type SignerConfig,
	deleteAdminToken,
	loadAdminToken,
	loadSignerConfig,
	saveAdminToken,
} from '../../lib/config.js';
import { getUserShare } from '../../lib/keychain.js';
import { buildRules, parseFormValues } from '../../lib/policy-conversions.js';
import { brand, danger, dim, failMark, promptTheme, success, warn } from '../theme.js';

// ---------------------------------------------------------------------------
// Error handler (clean output, no stack traces)
// ---------------------------------------------------------------------------

function withErrorHandler(
	// biome-ignore lint/suspicious/noExplicitAny: commander action callbacks use any[]
	fn: (...args: any[]) => Promise<void>,
	// biome-ignore lint/suspicious/noExplicitAny: commander action callbacks use any[]
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

interface PolicyDocument {
	rules: Record<string, unknown>[];
	status?: 'draft' | 'active';
	activatedAt?: string;
	version?: number;
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

function fmtCriterion(type: string, criterion: Record<string, unknown>): string {
	switch (type) {
		case 'evmAddress': {
			const op = criterion.operator as string;
			const addrs = (criterion.addresses as string[]) ?? [];
			const label = op === 'not_in' ? 'Blocked' : 'Approved';
			return `${label}: ${addrs.map(fmtAddr).join(', ') || dim('none')}`;
		}
		case 'maxPerTxUsd':
			return `Max/tx: $${criterion.maxUsd}`;
		case 'dailyLimitUsd':
			return `Daily: $${criterion.maxUsd}`;
		case 'monthlyLimitUsd':
			return `Monthly: $${criterion.maxUsd}`;
		case 'ethValue':
			return `ETH value ${criterion.operator ?? '<='} ${criterion.value}`;
		case 'rateLimit':
			return `Rate: ${criterion.maxPerHour}/hr`;
		case 'timeWindow':
			return `Hours: ${criterion.startHour}:00–${criterion.endHour}:00 UTC`;
		case 'evmNetwork': {
			const ids = (criterion.chainIds as number[]) ?? [];
			return `Chains: ${ids.join(', ')}`;
		}
		case 'evmFunction': {
			const sels = (criterion.selectors as string[]) ?? [];
			return `Functions: ${sels.join(', ') || dim('any')}`;
		}
		case 'ipAddress': {
			const ips = (criterion.ips as string[]) ?? [];
			return `IPs: ${ips.join(', ')}`;
		}
		case 'blockInfiniteApprovals':
			return 'Block infinite approvals';
		case 'maxSlippage':
			return `Max slippage: ${criterion.maxPercent}%`;
		case 'mevProtection':
			return `MEV protection ${dim('(advisory)')}`;
		default:
			return `${type}: ${JSON.stringify(criterion)}`;
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
	const spinner = ora({ text: 'Fetching policy\u2026', indent: 2 }).start();

	let doc: PolicyDocument | null = null;
	try {
		doc = await adminFetch<PolicyDocument>(
			ctx.config.serverUrl,
			`/signers/${ctx.signerId}/policy`,
			ctx.headers,
		);
	} catch {
		// No active policy
	}

	spinner.stop();

	console.log('');
	console.log(
		`  Policy for ${chalk.bold(ctx.signerName)} ${dim(`(${fmtAddr(ctx.config.ethAddress)})`)}`,
	);
	console.log('');

	if (!doc || !doc.rules || doc.rules.length === 0) {
		console.log(dim('  No policy configured.'));
		console.log(dim(`  Run ${chalk.reset('gw admin policies edit')} to create one.`));
	} else {
		console.log(
			`  ${dim('Status:')} ${doc.status === 'active' ? success('active') : warn('draft')}`,
		);
		if (doc.version) console.log(`  ${dim('Version:')} ${doc.version}`);
		console.log('');

		for (const rule of doc.rules) {
			const action = (rule as { action?: string }).action ?? 'accept';
			const criteria = (rule as { criteria?: Record<string, unknown>[] }).criteria ?? [];
			const actionLabel = action === 'reject' ? danger('REJECT') : success('ACCEPT');

			console.log(`  ${actionLabel} if:`);
			for (const criterion of criteria) {
				const type = criterion.type as string;
				console.log(`    ${fmtCriterion(type, criterion)}`);
			}
			console.log('');
		}

		console.log(dim('  Always-on: Scam blacklist, Contract scanner'));
	}
	console.log('');
}

const policiesEditCommand = new Command('edit')
	.description('Edit policy rules interactively')
	.action(
		withErrorHandler(async (_opts: unknown, command: CommandType) => {
			const ctx = await getAdminContext(command);
			const spinner = ora({ text: 'Fetching current policy\u2026', indent: 2 }).start();

			let currentRules: Record<string, unknown>[] = [];
			try {
				const doc = await adminFetch<PolicyDocument>(
					ctx.config.serverUrl,
					`/signers/${ctx.signerId}/policy`,
					ctx.headers,
				);
				currentRules = doc.rules ?? [];
			} catch {
				// No active policy
			}

			// Also check for draft
			try {
				const draft = await adminFetch<PolicyDocument>(
					ctx.config.serverUrl,
					`/signers/${ctx.signerId}/policy/draft`,
					ctx.headers,
				);
				if (draft.rules && draft.rules.length > 0) {
					currentRules = draft.rules;
				}
			} catch {
				// No draft
			}

			spinner.stop();
			const { values, enabled } = parseFormValues(currentRules);
			const newEnabled: Record<string, boolean> = { ...enabled };
			const newValues: Record<string, Record<string, unknown>> = { ...values };

			const editableCriteria = CRITERION_CATALOG.filter((m) => !m.alwaysOn);

			console.log('');
			console.log(brand('  Configure policy rules'));
			console.log(dim('  Toggle rules on/off, then set values for enabled rules.'));
			console.log('');

			for (const meta of editableCriteria) {
				const isEnabled = newEnabled[meta.type] ?? false;
				const shouldEnable = await confirm({
					message: `${meta.label} \u2014 ${meta.description}`,
					default: isEnabled,
					theme: promptTheme,
				});

				newEnabled[meta.type] = shouldEnable;

				if (shouldEnable && meta.fields.length > 0) {
					const fieldValues = newValues[meta.type] ?? meta.fromCriterion({});

					for (const field of meta.fields) {
						const currentVal = fieldValues[field.key];

						if (field.type === 'toggle') {
							fieldValues[field.key] = await confirm({
								message: `  ${field.label}`,
								default: currentVal !== false,
								theme: promptTheme,
							});
						} else if (
							field.type === 'addresses' ||
							field.type === 'selectors' ||
							field.type === 'ips'
						) {
							const current = (currentVal as string[]) ?? [];
							const answer = await input({
								message: `  ${field.label} (comma-separated)`,
								default: current.join(', '),
								theme: promptTheme,
							});
							fieldValues[field.key] = answer
								.split(',')
								.map((s) => s.trim())
								.filter(Boolean);
						} else if (field.type === 'chains') {
							const current = (currentVal as number[]) ?? [];
							const answer = await input({
								message: `  ${field.label} (chain IDs, comma-separated)`,
								default: current.join(', '),
								theme: promptTheme,
							});
							fieldValues[field.key] = answer
								.split(',')
								.map((s) => Number(s.trim()))
								.filter((n) => !Number.isNaN(n));
						} else {
							const suffix = field.unit ? ` (${field.unit})` : '';
							const answer = await input({
								message: `  ${field.label}${suffix}`,
								default: currentVal !== undefined ? String(currentVal) : undefined,
								theme: promptTheme,
							});
							fieldValues[field.key] = answer === '' ? undefined : Number(answer);
						}
					}

					newValues[meta.type] = fieldValues;
				}
			}

			// Build rules
			const rules = buildRules(newValues, newEnabled);
			const enabledCount = Object.values(newEnabled).filter(Boolean).length;

			console.log('');
			console.log(`  ${enabledCount} rule${enabledCount !== 1 ? 's' : ''} configured.`);

			if (rules.length === 0) {
				console.log(warn('  No rules \u2014 all transactions will use default deny.'));
			}

			const ok = await confirm({
				message: 'Save and activate this policy?',
				default: true,
				theme: promptTheme,
			});

			if (!ok) {
				console.log(dim('\n  Cancelled.\n'));
				return;
			}

			const saveSpinner = ora({ text: 'Saving policy\u2026', indent: 2 }).start();

			await adminFetch<void>(
				ctx.config.serverUrl,
				`/signers/${ctx.signerId}/policy/draft`,
				ctx.headers,
				'PUT',
				{ rules },
			);

			await adminFetch<void>(
				ctx.config.serverUrl,
				`/signers/${ctx.signerId}/policy/activate`,
				ctx.headers,
				'POST',
			);

			saveSpinner.succeed(`Policy activated (${enabledCount} rules)`);
			console.log('');
		}),
	);

const policiesActivateCommand = new Command('activate')
	.description('Activate the draft policy')
	.action(
		withErrorHandler(async (_opts: unknown, command: CommandType) => {
			const ctx = await getAdminContext(command);

			const ok = await confirm({
				message: 'Activate draft policy? This replaces the current active policy.',
				default: true,
				theme: promptTheme,
			});

			if (!ok) {
				console.log(dim('\n  Cancelled.\n'));
				return;
			}

			const spinner = ora({ text: 'Activating\u2026', indent: 2 }).start();

			await adminFetch<void>(
				ctx.config.serverUrl,
				`/signers/${ctx.signerId}/policy/activate`,
				ctx.headers,
				'POST',
			);

			spinner.succeed('Policy activated');
			console.log('');
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

policiesCommand.addCommand(policiesEditCommand);
policiesCommand.addCommand(policiesActivateCommand);

export const adminCommand = new Command('admin')
	.description('Admin operations (policies, pause/resume, audit)')
	.addCommand(unlockCommand)
	.addCommand(lockCommand)
	.addCommand(policiesCommand)
	.addCommand(pauseCommand)
	.addCommand(resumeCommand)
	.addCommand(auditCommand);
