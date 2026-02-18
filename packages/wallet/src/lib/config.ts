import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CGGMP24Scheme } from '@agentokratia/guardian-schemes';
import { GuardianApi, HttpClient, ThresholdSigner } from '@agentokratia/guardian-signer';

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface TwConfig {
	serverUrl: string;
	apiKey: string;
	apiSecret?: string;
	apiSecretFile?: string;
	network: string;
}

// ---------------------------------------------------------------------------
// Config file I/O
// ---------------------------------------------------------------------------

export function getConfigDir(): string {
	return join(homedir(), '.guardian-wallet');
}

export function getConfigPath(): string {
	return join(getConfigDir(), 'config.json');
}

export function configExists(): boolean {
	return existsSync(getConfigPath());
}

export function loadConfig(): TwConfig {
	const configPath = getConfigPath();

	if (!existsSync(configPath)) {
		throw new Error(`Config not found at ${configPath}. Run "guardian init" to set up.`);
	}

	const raw = readFileSync(configPath, 'utf-8');
	return JSON.parse(raw) as TwConfig;
}

export function saveConfig(config: TwConfig): void {
	const dir = getConfigDir();

	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}

	const configPath = getConfigPath();
	const tmpPath = `${configPath}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(config, null, '\t'), {
		mode: 0o600,
	});
	renameSync(tmpPath, configPath);
}

// ---------------------------------------------------------------------------
// Secret resolution
// ---------------------------------------------------------------------------

export function resolveApiSecret(config: TwConfig): string {
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
// Factory: config → { client, api, signer }
// ---------------------------------------------------------------------------

export function createClientFromConfig(config: TwConfig): {
	client: HttpClient;
	api: GuardianApi;
} {
	const client = new HttpClient({
		baseUrl: config.serverUrl,
		apiKey: config.apiKey,
	});
	const api = new GuardianApi(client);
	return { client, api };
}

export async function createSignerFromConfig(config: TwConfig): Promise<ThresholdSigner> {
	return ThresholdSigner.fromSecret({
		apiSecret: resolveApiSecret(config),
		serverUrl: config.serverUrl,
		apiKey: config.apiKey,
		scheme: new CGGMP24Scheme(),
	});
}
