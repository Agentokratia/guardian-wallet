import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface TwConfig {
	readonly serverUrl: string;
	readonly apiKey: string;
	/** Base64 keyshare string (inline). */
	readonly apiSecret?: string;
	/** Path to a file containing the base64 keyshare. */
	readonly apiSecretFile?: string;
	readonly network: string;
}

const CONFIG_DIR = join(homedir(), '.gw');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export function getConfigDir(): string {
	return CONFIG_DIR;
}

export function getConfigPath(): string {
	return CONFIG_PATH;
}

export function configExists(): boolean {
	return existsSync(CONFIG_PATH);
}

export function loadConfig(): TwConfig {
	if (!configExists()) {
		throw new Error('Configuration not found. Run `gw init` to set up your configuration.');
	}

	const raw = readFileSync(CONFIG_PATH, 'utf-8');
	let parsed: unknown;

	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`Invalid config file at ${CONFIG_PATH}. Run \`tw init\` to recreate.`);
	}

	if (!isValidConfig(parsed)) {
		throw new Error('Config file is missing required fields. Run `gw init` to recreate.');
	}

	return parsed;
}

export function saveConfig(config: TwConfig): void {
	const dir = dirname(CONFIG_PATH);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}

	// Write to a temp file with restrictive permissions first, then atomically rename.
	// This prevents a window where the file exists with default (world-readable) permissions.
	const tmpPath = `${CONFIG_PATH}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
	renameSync(tmpPath, CONFIG_PATH);
}

/**
 * Resolve the API secret from config — either inline `apiSecret` or read from `apiSecretFile`.
 */
export function resolveApiSecret(config: TwConfig): string {
	if (config.apiSecret && config.apiSecret.length > 0) {
		return config.apiSecret;
	}
	if (config.apiSecretFile && config.apiSecretFile.length > 0) {
		const resolved = config.apiSecretFile.startsWith('~')
			? join(homedir(), config.apiSecretFile.slice(1))
			: config.apiSecretFile;
		if (!existsSync(resolved)) {
			throw new Error(`API secret file not found: ${resolved}`);
		}
		return readFileSync(resolved, 'utf-8').trim();
	}
	throw new Error('Config missing apiSecret or apiSecretFile. Run `gw init` to reconfigure.');
}

function isValidConfig(value: unknown): value is TwConfig {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const obj = value as Record<string, unknown>;

	const hasSecret =
		(typeof obj.apiSecret === 'string' && obj.apiSecret.length > 0) ||
		(typeof obj.apiSecretFile === 'string' && obj.apiSecretFile.length > 0);

	return (
		typeof obj.serverUrl === 'string' &&
		obj.serverUrl.length > 0 &&
		typeof obj.apiKey === 'string' &&
		obj.apiKey.length > 0 &&
		hasSecret &&
		typeof obj.network === 'string' &&
		obj.network.length > 0
	);
}
