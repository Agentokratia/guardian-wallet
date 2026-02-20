import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
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
// Public API
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
	// -T ''  = empty trusted-app list. Strips default creator trust so macOS
	//          prompts for approval (Touch ID / password) on every read.
	// -j     = comment shown in Keychain Access.app for user clarity.
	// No keychain arg = default (login) keychain.
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
			'Guardian Wallet recovery key — used for admin auth',
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
