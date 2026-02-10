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
	};
}

export const APP_CONFIG = Symbol('APP_CONFIG');
