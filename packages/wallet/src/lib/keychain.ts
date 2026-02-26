import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';
import { getConfigDir } from './config.js';

// ---------------------------------------------------------------------------
// macOS login keychain via `security` CLI
//
// Same pattern as: gh (GitHub CLI), aws-vault, docker credential helper.
// Uses the default (login) keychain — auto-unlocked on user login.
//
// We store with -T '' (empty trusted-app list) so macOS prompts the user
// on every keychain read. On Macs with Touch ID this triggers biometric;
// on Mac Mini / headless it shows a password dialog.
//
// If the keychain read fails (headless SSH without GUI, locked keychain),
// getUserShare() falls through to the .user-share file fallback.
// During `gw init`, headless users should pick "Local file" storage.
//
// For SSH sessions: `security unlock-keychain` once per session, then
// the approval dialog still fires per-item access (because -T '').
// ---------------------------------------------------------------------------

const SERVICE_NAME = 'guardian-wallet';

// ---------------------------------------------------------------------------
// Session (JWT) storage
// ---------------------------------------------------------------------------

// Session tokens use file storage only (~/.gw/session.json, 0600).
// No keychain — a short-lived JWT doesn't need biometric protection,
// and keychain prompts add unnecessary friction for admin ops.

export async function storeSession(
	token: string,
	serverUrl?: string,
	refreshToken?: string,
): Promise<void> {
	storeSessionToFile(token, serverUrl, refreshToken);
}

export async function getSession(): Promise<string | null> {
	return loadSessionFromFile();
}

export async function getRefreshToken(): Promise<string | null> {
	return loadRefreshTokenFromFile();
}

export async function deleteSession(): Promise<boolean> {
	return deleteSessionFile();
}

// ---------------------------------------------------------------------------
// Public API — User Shares
// ---------------------------------------------------------------------------

export async function storeUserShare(
	signerName: string,
	shareBase64: string,
	target: 'keychain' | 'file' = 'keychain',
): Promise<void> {
	if (target === 'keychain') {
		macKeychainSet(signerName, shareBase64);
		return;
	}
	storeUserShareToFile(signerName, shareBase64);
}

export async function getUserShare(signerName: string): Promise<string | null> {
	if (isMacOS()) {
		try {
			return macKeychainGet(signerName);
		} catch {
			// Keychain locked, headless, or user denied → fall through to file
		}
	}
	return loadUserShareFromFile(signerName);
}

export async function deleteUserShare(signerName: string): Promise<boolean> {
	if (isMacOS()) {
		try {
			macKeychainDelete(signerName);
			return true;
		} catch {
			// fall through to file
		}
	}
	return deleteUserShareFile(signerName);
}

export async function isKeychainAvailable(): Promise<boolean> {
	if (!isMacOS()) return false;
	try {
		execFileSync('security', ['help'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// macOS Keychain
// ---------------------------------------------------------------------------

function isMacOS(): boolean {
	return platform() === 'darwin';
}

function macKeychainSet(account: string, secret: string): void {
	// -U     = upsert (update if exists, add if not). Atomic, no delete-then-add race.
	// -T ''  = empty trusted-app list → forces Touch ID / password on every read.
	//          Used for user shares (signing keys) — biometric gate for fund movement.
	// -j     = comment shown in Keychain Access.app for user clarity.
	execFileSync(
		'security',
		[
			'add-generic-password',
			'-U',
			'-s',
			SERVICE_NAME,
			'-a',
			account,
			'-w',
			secret,
			'-T',
			'',
			'-j',
			'Guardian Wallet signing key',
		],
		{ stdio: 'ignore' },
	);
}

function macKeychainGet(account: string): string | null {
	try {
		const result = execFileSync(
			'security',
			['find-generic-password', '-s', SERVICE_NAME, '-a', account, '-w'],
			{ encoding: 'utf-8' },
		);
		return result.trim() || null;
	} catch {
		return null;
	}
}

function macKeychainDelete(account: string): void {
	execFileSync('security', ['delete-generic-password', '-s', SERVICE_NAME, '-a', account], {
		stdio: 'ignore',
	});
}

// ---------------------------------------------------------------------------
// File-based fallback (Linux / Windows / CI / headless SSH)
// ---------------------------------------------------------------------------

function getUserShareFilePath(signerName: string): string {
	return join(getConfigDir(), 'signers', `${signerName}.user-share`);
}

function storeUserShareToFile(signerName: string, shareBase64: string): void {
	const p = getUserShareFilePath(signerName);
	const tmpPath = `${p}.tmp`;
	writeFileSync(tmpPath, shareBase64, { mode: 0o600 });
	renameSync(tmpPath, p);
}

function loadUserShareFromFile(signerName: string): string | null {
	const p = getUserShareFilePath(signerName);
	if (!existsSync(p)) return null;
	return readFileSync(p, 'utf-8').trim();
}

function deleteUserShareFile(signerName: string): boolean {
	const p = getUserShareFilePath(signerName);
	if (!existsSync(p)) return false;
	unlinkSync(p);
	return true;
}

// ---------------------------------------------------------------------------
// File-based session fallback
// ---------------------------------------------------------------------------

function getSessionFilePath(): string {
	return join(getConfigDir(), 'session.json');
}

function storeSessionToFile(token: string, serverUrl?: string, refreshToken?: string): void {
	const dir = getConfigDir();
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}
	const p = getSessionFilePath();
	const tmpPath = `${p}.tmp`;
	const payload: Record<string, string> = { token, createdAt: new Date().toISOString() };
	if (serverUrl) payload.serverUrl = serverUrl;
	if (refreshToken) payload.refreshToken = refreshToken;
	writeFileSync(tmpPath, JSON.stringify(payload), { mode: 0o600 });
	renameSync(tmpPath, p);
}

function loadSessionFromFile(): string | null {
	const p = getSessionFilePath();
	if (!existsSync(p)) return null;
	try {
		const data = JSON.parse(readFileSync(p, 'utf-8')) as { token?: string };
		return data.token ?? null;
	} catch {
		return null;
	}
}

function loadRefreshTokenFromFile(): string | null {
	const p = getSessionFilePath();
	if (!existsSync(p)) return null;
	try {
		const data = JSON.parse(readFileSync(p, 'utf-8')) as { refreshToken?: string };
		return data.refreshToken ?? null;
	} catch {
		return null;
	}
}

/** Read the server URL stored alongside the session token (if present). */
export async function getSessionServerUrl(): Promise<string | null> {
	const p = getSessionFilePath();
	if (!existsSync(p)) return null;
	try {
		const data = JSON.parse(readFileSync(p, 'utf-8')) as { serverUrl?: string };
		return data.serverUrl ?? null;
	} catch {
		return null;
	}
}

function deleteSessionFile(): boolean {
	const p = getSessionFilePath();
	if (!existsSync(p)) return false;
	unlinkSync(p);
	return true;
}
