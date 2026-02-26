import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CGGMP24Scheme } from '@agentokratia/guardian-schemes';
import { GuardianApi, HttpClient, ThresholdSigner } from '@agentokratia/guardian-signer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SignerConfig {
	version: 1;
	serverUrl: string;
	apiKey: string;
	apiSecret?: string;
	network?: string;
	signerName: string;
	ethAddress: string;
	signerId?: string;
	createdAt?: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const CONFIG_DIR = join(homedir(), '.guardian-wallet');

export function getConfigDir(): string {
	return CONFIG_DIR;
}

export function getSignerConfigPath(name: string): string {
	return join(CONFIG_DIR, 'signers', `${name}.json`);
}

// ---------------------------------------------------------------------------
// Name validation
// ---------------------------------------------------------------------------

const VALID_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export function validateSignerName(name: string): string | null {
	if (!name) return 'Account name cannot be empty';
	if (!VALID_NAME_RE.test(name)) {
		return 'Must be 1-64 chars: letters, numbers, hyphens, underscores. Start with alphanumeric.';
	}
	return null;
}

// ---------------------------------------------------------------------------
// Default signer
// ---------------------------------------------------------------------------

export function getDefaultSignerName(): string | null {
	const p = join(CONFIG_DIR, '.default');
	if (!existsSync(p)) return null;
	return readFileSync(p, 'utf-8').trim() || null;
}

export function setDefaultSigner(name: string): void {
	ensureDir(CONFIG_DIR);
	writeFileSync(join(CONFIG_DIR, '.default'), `${name}\n`, { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// List / resolve signers
// ---------------------------------------------------------------------------

export function listSigners(): string[] {
	const dir = join(CONFIG_DIR, 'signers');
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.endsWith('.json') && !f.endsWith('.recovery.json'))
		.map((f) => f.replace(/\.json$/, ''))
		.filter((name) => {
			try {
				const raw = readFileSync(getSignerConfigPath(name), 'utf-8');
				const config = JSON.parse(raw);
				return typeof config.serverUrl === 'string' && typeof config.apiKey === 'string';
			} catch {
				return false;
			}
		});
}

export function resolveSignerName(explicit?: string): string {
	if (explicit) return explicit;

	const defaultName = getDefaultSignerName();
	if (defaultName) return defaultName;

	const signers = listSigners();
	if (signers.length === 1) return signers[0] as string;
	if (signers.length === 0) {
		throw new Error('No accounts configured. Run `gw init` first.');
	}
	throw new Error(
		`Multiple accounts found: ${signers.join(', ')}.\nUse --signer <name> or run \`gw init\` to set a default.`,
	);
}

// ---------------------------------------------------------------------------
// Signer config I/O
// ---------------------------------------------------------------------------

export function loadSignerConfig(name?: string): SignerConfig {
	const signerName = resolveSignerName(name);
	const p = getSignerConfigPath(signerName);
	if (!existsSync(p)) {
		throw new Error(`Account "${signerName}" not found. Run \`gw init\` first.`);
	}
	return JSON.parse(readFileSync(p, 'utf-8')) as SignerConfig;
}

export function saveSignerConfig(name: string, config: SignerConfig): void {
	ensureDir(join(CONFIG_DIR, 'signers'));
	const p = getSignerConfigPath(name);
	const tmp = `${p}.tmp`;
	writeFileSync(tmp, JSON.stringify(config, null, '\t'), { mode: 0o600 });
	renameSync(tmp, p);
}

// ---------------------------------------------------------------------------
// Recovery metadata (recovery-only devices — no secrets, public info only)
// ---------------------------------------------------------------------------

export interface RecoveryMeta {
	signerName: string;
	signerId: string;
	ethAddress: string;
	serverUrl: string;
	network?: string;
	receivedAt: string;
}

function getRecoveryMetaPath(name: string): string {
	return join(CONFIG_DIR, 'signers', `${name}.recovery.json`);
}

export function saveRecoveryMeta(name: string, meta: RecoveryMeta): void {
	ensureDir(join(CONFIG_DIR, 'signers'));
	const p = getRecoveryMetaPath(name);
	const tmp = `${p}.tmp`;
	writeFileSync(tmp, JSON.stringify(meta, null, '\t'), { mode: 0o600 });
	renameSync(tmp, p);
}

export function loadRecoveryMeta(name: string): RecoveryMeta | null {
	const p = getRecoveryMetaPath(name);
	if (!existsSync(p)) return null;
	try {
		return JSON.parse(readFileSync(p, 'utf-8')) as RecoveryMeta;
	} catch {
		return null;
	}
}

export function listRecoveryMetas(): RecoveryMeta[] {
	const dir = join(CONFIG_DIR, 'signers');
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.endsWith('.recovery.json'))
		.map((f) => {
			try {
				return JSON.parse(readFileSync(join(dir, f), 'utf-8')) as RecoveryMeta;
			} catch {
				return null;
			}
		})
		.filter((m): m is RecoveryMeta => m !== null);
}

// ---------------------------------------------------------------------------
// Secret resolution
// ---------------------------------------------------------------------------

export function resolveApiSecret(config: SignerConfig): string {
	if (config.apiSecret) return config.apiSecret;
	throw new Error(
		'No API secret found in config. Run `gw init` to reconfigure with your API Secret from Guardian.',
	);
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export function createClientFromConfig(config: { serverUrl: string; apiKey: string }): {
	client: HttpClient;
	api: GuardianApi;
} {
	const client = new HttpClient({ baseUrl: config.serverUrl, apiKey: config.apiKey });
	const api = new GuardianApi(client);
	return { client, api };
}

export async function createSignerFromConfig(config: SignerConfig): Promise<ThresholdSigner> {
	return ThresholdSigner.fromSecret({
		apiSecret: resolveApiSecret(config),
		serverUrl: config.serverUrl,
		apiKey: config.apiKey,
		scheme: new CGGMP24Scheme(),
	});
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}
}
