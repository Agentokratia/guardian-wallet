import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	unlinkSync,
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
	apiSecretFile?: string;
	network?: string;
	signerName: string;
	ethAddress: string;
	signerId?: string;
	createdAt?: string;
}

export interface AdminToken {
	token: string;
	createdAt: string;
	expiresAt?: string | null;
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

export function getAdminTokenPath(name: string): string {
	return join(CONFIG_DIR, 'admin', `${name}.token`);
}

// ---------------------------------------------------------------------------
// Name validation
// ---------------------------------------------------------------------------

const VALID_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export function validateSignerName(name: string): string | null {
	if (!name) return 'Signer name cannot be empty';
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
		.filter((f) => f.endsWith('.json'))
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
		throw new Error('No signers configured. Run `gw init` first.');
	}
	throw new Error(
		`Multiple signers found: ${signers.join(', ')}.\nUse --signer <name> or run \`gw init\` to set a default.`,
	);
}

// ---------------------------------------------------------------------------
// Signer config I/O
// ---------------------------------------------------------------------------

export function loadSignerConfig(name?: string): SignerConfig {
	const signerName = resolveSignerName(name);
	const p = getSignerConfigPath(signerName);
	if (!existsSync(p)) {
		throw new Error(`Signer "${signerName}" not found. Run \`gw init\` first.`);
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
// Admin token I/O
// ---------------------------------------------------------------------------

export type AdminTokenResult =
	| { status: 'valid'; token: AdminToken }
	| { status: 'expired' }
	| { status: 'missing' }
	| { status: 'corrupt' };

export function loadAdminToken(name: string): AdminTokenResult {
	const p = getAdminTokenPath(name);
	if (!existsSync(p)) return { status: 'missing' };
	try {
		const token = JSON.parse(readFileSync(p, 'utf-8')) as AdminToken;
		if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
			unlinkSync(p);
			return { status: 'expired' };
		}
		return { status: 'valid', token };
	} catch {
		return { status: 'corrupt' };
	}
}

export function saveAdminToken(name: string, token: AdminToken): void {
	ensureDir(join(CONFIG_DIR, 'admin'));
	const p = getAdminTokenPath(name);
	const tmp = `${p}.tmp`;
	writeFileSync(tmp, JSON.stringify(token, null, '\t'), { mode: 0o600 });
	renameSync(tmp, p);
}

export function deleteAdminToken(name: string): boolean {
	const p = getAdminTokenPath(name);
	if (!existsSync(p)) return false;
	unlinkSync(p);
	return true;
}

// ---------------------------------------------------------------------------
// Secret resolution
// ---------------------------------------------------------------------------

export function resolveApiSecret(config: SignerConfig): string {
	if (config.apiSecret) return config.apiSecret;
	if (config.apiSecretFile) {
		const filePath = config.apiSecretFile.startsWith('~')
			? join(homedir(), config.apiSecretFile.slice(1))
			: config.apiSecretFile;
		return readFileSync(filePath, 'utf-8').trim();
	}
	throw new Error('No API secret configured. Set apiSecret or apiSecretFile in config.');
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
