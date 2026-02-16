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

	// Auth
	readonly JWT_SECRET: string;
	readonly JWT_EXPIRY: string;

	// WebAuthn
	readonly RP_ID: string;
	readonly RP_NAME: string;
	readonly ALLOWED_ORIGINS: string[];

	// Email
	readonly EMAIL_PROVIDER: 'console' | 'resend';
	readonly RESEND_API_KEY: string;

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

export function parseConfig(): AppConfig {
	const jwtSecret = requireEnv('JWT_SECRET');
	if (jwtSecret.length < 16) {
		throw new Error('JWT_SECRET must be at least 16 characters');
	}

	const portStr = process.env['PORT'];
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

	return {
		NODE_ENV: optionalEnv('NODE_ENV', 'development'),
		PORT: port,

		SUPABASE_URL: requireEnv('SUPABASE_URL'),
		SUPABASE_SERVICE_KEY: requireEnv('SUPABASE_SERVICE_KEY'),

		VAULT_ADDR: requireEnv('VAULT_ADDR'),
		VAULT_TOKEN: requireEnv('VAULT_TOKEN'),
		VAULT_KV_MOUNT: optionalEnv('VAULT_KV_MOUNT', 'secret'),
		VAULT_SHARE_PREFIX: optionalEnv('VAULT_SHARE_PREFIX', 'threshold/shares'),

		JWT_SECRET: jwtSecret,
		JWT_EXPIRY: optionalEnv('JWT_EXPIRY', '24h'),

		RP_ID: optionalEnv('RP_ID', 'localhost'),
		RP_NAME: optionalEnv('RP_NAME', 'Guardian Wallet'),
		ALLOWED_ORIGINS: optionalEnv('ALLOWED_ORIGINS', 'http://localhost:3000').split(',').map((s) => s.trim()),

		EMAIL_PROVIDER: (optionalEnv('EMAIL_PROVIDER', 'console') as 'console' | 'resend'),
		RESEND_API_KEY: optionalEnv('RESEND_API_KEY', ''),

		AUXINFO_POOL_TARGET: poolTarget,
		AUXINFO_POOL_LOW_WATERMARK: poolLowWatermark,
		AUXINFO_POOL_MAX_GENERATORS: poolMaxGenerators,
	};
}

export const APP_CONFIG = Symbol('APP_CONFIG');
