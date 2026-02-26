function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

function optionalEnv(name: string, fallback: string): string {
	return process.env[name] || fallback;
}

export interface AppConfig {
	readonly NODE_ENV: string;
	readonly PORT: number;

	// Supabase
	readonly SUPABASE_URL: string;
	readonly SUPABASE_SERVICE_KEY: string;

	// Vault
	readonly VAULT_ADDR: string;
	readonly VAULT_TOKEN: string;
	readonly VAULT_KV_MOUNT: string;
	readonly VAULT_SHARE_PREFIX: string;

	// KMS
	readonly KMS_PROVIDER: 'vault-kv' | 'local-file';
	readonly KMS_LOCAL_KEY_FILE: string;

	// Auth
	readonly JWT_SECRET: string;
	readonly JWT_EXPIRY: string;
	/** Pre-parsed JWT_EXPIRY in milliseconds (for cookie maxAge). */
	readonly JWT_EXPIRY_MS: number;

	// WebAuthn
	readonly RP_ID: string;
	readonly RP_NAME: string;
	readonly ALLOWED_ORIGINS: string[];

	// Email
	readonly EMAIL_PROVIDER: 'console' | 'resend';
	readonly RESEND_API_KEY: string;

	// Public signer creation rate limit (per IP per hour)
	readonly PUBLIC_CREATE_LIMIT: number;

	// AuxInfo Pool
	readonly AUXINFO_POOL_TARGET: number;
	readonly AUXINFO_POOL_LOW_WATERMARK: number;
	readonly AUXINFO_POOL_MAX_GENERATORS: number;
}

function parsePoolInt(name: string, fallback: string): number {
	const val = Number.parseInt(optionalEnv(name, fallback), 10);
	if (Number.isNaN(val) || val < 0) {
		throw new Error(`${name} must be a non-negative integer`);
	}
	return val;
}

function parsePoolMaxGenerators(name: string, fallback: string): number {
	const val = Number.parseInt(optionalEnv(name, fallback), 10);
	if (Number.isNaN(val) || val < 1 || val > 10) {
		throw new Error(`${name} must be between 1 and 10`);
	}
	return val;
}

/** Validate JWT_EXPIRY format matches what both jsonwebtoken and cookie maxAge can use. */
function parseAndValidateExpiry(expiry: string): string {
	if (!/^\d+[smhd]$/.test(expiry)) {
		throw new Error(
			`Invalid JWT_EXPIRY format: "${expiry}". Must be a number followed by s/m/h/d (e.g. "15m", "1h", "7d").`,
		);
	}
	return expiry;
}

/** Convert shorthand expiry (e.g. '15m', '1h', '7d') to milliseconds. */
function parseExpiryToMs(expiry: string): number {
	const match = expiry.match(/^(\d+)([smhd])$/);
	if (!match) throw new Error(`Cannot parse expiry: "${expiry}"`);
	const value = Number.parseInt(match[1] as string, 10);
	switch (match[2]) {
		case 's':
			return value * 1000;
		case 'm':
			return value * 60 * 1000;
		case 'h':
			return value * 3600 * 1000;
		case 'd':
			return value * 86400 * 1000;
		default:
			throw new Error(`Unknown unit: ${match[2]}`);
	}
}

export function parseConfig(): AppConfig {
	const jwtSecret = requireEnv('JWT_SECRET');
	if (jwtSecret.length < 32) {
		throw new Error('JWT_SECRET must be at least 32 characters (256 bits for HS256)');
	}

	const portStr = process.env.PORT;
	const port = portStr ? Number.parseInt(portStr, 10) : 8080;
	if (Number.isNaN(port)) {
		throw new Error(`PORT must be a valid number, got: ${portStr}`);
	}

	const poolTarget = parsePoolInt('AUXINFO_POOL_TARGET', '5');
	const poolLowWatermark = parsePoolInt('AUXINFO_POOL_LOW_WATERMARK', '2');
	const poolMaxGenerators = parsePoolMaxGenerators('AUXINFO_POOL_MAX_GENERATORS', '2');

	if (poolLowWatermark >= poolTarget) {
		throw new Error(
			`AUXINFO_POOL_LOW_WATERMARK (${poolLowWatermark}) must be less than AUXINFO_POOL_TARGET (${poolTarget})`,
		);
	}

	const kmsProviderRaw = optionalEnv('KMS_PROVIDER', 'vault-kv');
	const validKmsProviders = ['vault-kv', 'local-file'] as const;
	if (!validKmsProviders.includes(kmsProviderRaw as (typeof validKmsProviders)[number])) {
		throw new Error(
			`KMS_PROVIDER must be one of: ${validKmsProviders.join(', ')}. Got: ${kmsProviderRaw}`,
		);
	}
	const kmsProvider = kmsProviderRaw as 'vault-kv' | 'local-file';
	const vaultAddr = optionalEnv('VAULT_ADDR', '');
	const vaultToken = optionalEnv('VAULT_TOKEN', '');
	const kmsLocalKeyFile = optionalEnv('KMS_LOCAL_KEY_FILE', '');

	if (kmsProvider === 'vault-kv') {
		if (!vaultAddr) throw new Error('VAULT_ADDR is required when KMS_PROVIDER=vault-kv');
		if (!vaultToken) throw new Error('VAULT_TOKEN is required when KMS_PROVIDER=vault-kv');
	}

	if (kmsProvider === 'local-file') {
		if (!kmsLocalKeyFile)
			throw new Error('KMS_LOCAL_KEY_FILE is required when KMS_PROVIDER=local-file');
	}

	const emailProvider = optionalEnv('EMAIL_PROVIDER', 'console') as 'console' | 'resend';
	const resendApiKey = optionalEnv('RESEND_API_KEY', '');
	if (emailProvider === 'resend' && !resendApiKey) {
		throw new Error('RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
	}

	return {
		NODE_ENV: optionalEnv('NODE_ENV', 'development'),
		PORT: port,

		SUPABASE_URL: requireEnv('SUPABASE_URL'),
		SUPABASE_SERVICE_KEY: requireEnv('SUPABASE_SERVICE_KEY'),

		VAULT_ADDR: vaultAddr,
		VAULT_TOKEN: vaultToken,
		VAULT_KV_MOUNT: optionalEnv('VAULT_KV_MOUNT', 'secret'),
		VAULT_SHARE_PREFIX: optionalEnv('VAULT_SHARE_PREFIX', 'threshold/shares'),

		KMS_PROVIDER: kmsProvider,
		KMS_LOCAL_KEY_FILE: kmsLocalKeyFile,

		JWT_SECRET: jwtSecret,
		JWT_EXPIRY: parseAndValidateExpiry(optionalEnv('JWT_EXPIRY', '15m')),
		JWT_EXPIRY_MS: parseExpiryToMs(optionalEnv('JWT_EXPIRY', '15m')),

		RP_ID: optionalEnv('RP_ID', 'localhost'),
		RP_NAME: optionalEnv('RP_NAME', 'Guardian Wallet'),
		ALLOWED_ORIGINS: optionalEnv('ALLOWED_ORIGINS', 'http://localhost:3000')
			.split(',')
			.map((s) => s.trim()),

		EMAIL_PROVIDER: emailProvider,
		RESEND_API_KEY: resendApiKey,

		PUBLIC_CREATE_LIMIT: parsePoolInt('PUBLIC_CREATE_LIMIT', '20'),

		AUXINFO_POOL_TARGET: poolTarget,
		AUXINFO_POOL_LOW_WATERMARK: poolLowWatermark,
		AUXINFO_POOL_MAX_GENERATORS: poolMaxGenerators,
	};
}

export const APP_CONFIG = Symbol('APP_CONFIG');
