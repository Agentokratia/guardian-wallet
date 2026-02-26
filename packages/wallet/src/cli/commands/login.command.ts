import { input, password } from '@inquirer/prompts';
import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { getConfigDir } from '../../lib/config.js';
import {
	deleteSession,
	getRefreshToken,
	getSession,
	getSessionServerUrl,
	storeSession,
} from '../../lib/keychain.js';
import { dim, failMark, promptTheme, section, success, successMark } from '../theme.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string, body: unknown): Promise<T> {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(15_000),
	});

	if (!response.ok) {
		const text = await response.text();
		// Extract human-readable message from JSON error responses
		try {
			const json = JSON.parse(text) as { message?: string };
			if (json.message) throw new Error(json.message);
		} catch (e) {
			if (e instanceof Error && e.message !== text) throw e;
		}
		throw new Error(`Server error (${response.status})`);
	}

	return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// gw login
// ---------------------------------------------------------------------------

export const loginCommand = new Command('login')
	.description('Log in with email + OTP')
	.option('--server <url>', 'Server URL', 'http://localhost:8080')
	.action(async (opts: { server: string }) => {
		try {
			// Check if already logged in
			const existing = await getSession();
			if (existing) {
				console.log(
					`\n  ${dim('Already logged in. Run')} ${chalk.bold('gw logout')} ${dim('to switch accounts.')}\n`,
				);
				return;
			}

			section('Login');

			const email = await input({
				message: 'Email',
				theme: promptTheme,
				validate: (v) => {
					if (!v.includes('@')) return 'Enter a valid email address';
					return true;
				},
			});

			const baseUrl = opts.server.replace(/\/+$/, '');

			// Send OTP
			const spinner = ora({ text: 'Sending verification code…', indent: 2 }).start();
			try {
				await fetchJson(`${baseUrl}/api/v1/auth/login`, { email, sendOtp: true });
				spinner.succeed('Verification code sent');
			} catch (err) {
				spinner.fail('Failed to send verification code');
				throw err;
			}

			console.log('');

			const code = await password({
				message: 'Enter the 6-digit code from your email',
				mask: '*',
				theme: promptTheme,
			});

			if (!code) throw new Error('Code is required');

			// Verify OTP
			const verifySpinner = ora({ text: 'Verifying…', indent: 2 }).start();
			let result: {
				token: string;
				refreshToken?: string;
				userId: string;
				email: string;
				address?: string;
			};
			try {
				result = await fetchJson(`${baseUrl}/api/v1/auth/verify-otp`, { email, code });
			} catch (err) {
				verifySpinner.fail('Verification failed');
				throw err;
			}

			// Store JWT + refresh token + server URL (so `gw receive` works without `gw init`)
			await storeSession(result.token, baseUrl, result.refreshToken);
			verifySpinner.succeed('Logged in');

			console.log('');
			console.log(`  ${successMark(`Authenticated as ${chalk.bold(result.email)}`)}`);
			console.log(`  ${dim(`Session stored in ${getConfigDir()}`)}`);
			console.log('');
			console.log(`  ${success('Done!')} Run ${chalk.bold('gw init')} to create a wallet,`);
			console.log(`         or ${chalk.bold('gw receive')} to import a share from another device.`);
			console.log('');
		} catch (error: unknown) {
			if (error instanceof Error && error.name === 'ExitPromptError') {
				console.log(dim('\n  Cancelled.\n'));
				return;
			}
			const message = error instanceof Error ? error.message : 'Unknown error';
			console.error(`\n  ${failMark(message)}\n`);
			process.exitCode = 1;
		}
	});

// ---------------------------------------------------------------------------
// gw logout
// ---------------------------------------------------------------------------

export const logoutCommand = new Command('logout')
	.description('Log out (clear session)')
	.action(async () => {
		try {
			// Revoke refresh tokens server-side before clearing local session
			const token = await getSession();
			const refreshToken = await getRefreshToken();
			const serverUrl = await getSessionServerUrl();
			if (serverUrl && (token || refreshToken)) {
				try {
					await fetch(`${serverUrl}/api/v1/auth/logout`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							...(token ? { authorization: `Bearer ${token}` } : {}),
						},
						body: JSON.stringify({ refreshToken: refreshToken ?? undefined }),
						signal: AbortSignal.timeout(5_000),
					});
				} catch {
					// Best-effort — still clear local session even if server unreachable
				}
			}

			const deleted = await deleteSession();
			if (deleted) {
				console.log(`\n  ${successMark('Logged out')}\n`);
			} else {
				console.log(`\n  ${dim('No active session found.')}\n`);
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			console.error(`\n  ${failMark(message)}\n`);
			process.exitCode = 1;
		}
	});
