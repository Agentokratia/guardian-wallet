import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { loadSignerConfig, resolveSignerName } from '../../lib/config.js';
import { getSession, getUserShare } from '../../lib/keychain.js';
import { encryptShareForTransfer, generateTransferCode } from '../../lib/transfer-crypto.js';
import { brand, dim, failMark, hint, section, success } from '../theme.js';

// ---------------------------------------------------------------------------
// gw link <signer> — Export share to another device via 6-word code
// ---------------------------------------------------------------------------

export const linkCommand = new Command('link')
	.description('Send recovery key to Guardian (via 6-word transfer code)')
	.argument('[signer]', 'Signer name')
	.option('--server <url>', 'Server URL override')
	.action(async (signerArg: string | undefined, opts: { server?: string }) => {
		try {
			// 1. Require session
			const token = await getSession();
			if (!token) {
				console.error(`\n  ${failMark(`Not logged in. Run ${chalk.bold('gw login')} first.`)}\n`);
				process.exitCode = 1;
				return;
			}

			const signerName = resolveSignerName(signerArg);
			const config = loadSignerConfig(signerName);
			const signerId = config.signerId;
			if (!signerId) {
				throw new Error('No signer ID in config. Re-run `gw init` or add signerId to config.');
			}

			const baseUrl = (opts.server ?? config.serverUrl).replace(/\/+$/, '');

			// 2. Read user share from keychain (triggers biometric)
			section('Send to Guardian');
			hint('Reading recovery key from keychain — you may be prompted for biometric auth.');
			console.log('');

			const spinner = ora({ text: 'Reading recovery key…', indent: 2 }).start();
			const userShare = await getUserShare(signerName);
			if (!userShare) {
				spinner.fail('No recovery key found');
				console.error(dim('\n  Was this wallet created via `gw init`?\n'));
				process.exitCode = 1;
				return;
			}
			spinner.succeed('Recovery key loaded');

			// 3. Initiate transfer on server
			const initSpinner = ora({ text: 'Creating transfer session…', indent: 2 }).start();
			const initResponse = await fetch(`${baseUrl}/api/v1/auth/transfer/initiate`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({ signerId, direction: 'cli_to_dashboard' }),
				signal: AbortSignal.timeout(15_000),
			});

			if (!initResponse.ok) {
				const text = await initResponse.text();
				initSpinner.fail('Failed to create transfer');
				throw new Error(`Server returned ${initResponse.status}: ${text}`);
			}

			const { transferId, expiresAt } = (await initResponse.json()) as {
				transferId: string;
				expiresAt: string;
			};
			initSpinner.succeed('Transfer session created');

			// 4. Generate 6-word code + encrypt share
			const encryptSpinner = ora({ text: 'Encrypting share…', indent: 2 }).start();
			const { words, transferKey } = generateTransferCode(transferId);
			const shareBytes = Buffer.from(userShare, 'base64');
			const encryptedPayload = await encryptShareForTransfer(shareBytes, transferKey);

			// Wipe sensitive material
			shareBytes.fill(0);
			transferKey.fill(0);
			encryptSpinner.succeed('Share encrypted');

			// 5. Upload encrypted payload
			const uploadSpinner = ora({ text: 'Uploading…', indent: 2 }).start();
			const uploadResponse = await fetch(`${baseUrl}/api/v1/auth/transfer/${transferId}`, {
				method: 'PATCH',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({ encryptedPayload }),
				signal: AbortSignal.timeout(15_000),
			});

			if (!uploadResponse.ok) {
				const text = await uploadResponse.text();
				uploadSpinner.fail('Failed to upload');
				throw new Error(`Server returned ${uploadResponse.status}: ${text}`);
			}
			uploadSpinner.succeed('Transfer ready');

			// 6. Display code
			const expiresIn = Math.max(
				0,
				Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000),
			);

			console.log('');
			console.log(`  ${brand('Transfer code:')}`);
			console.log('');
			console.log(`     ${chalk.bold.cyan(words.join('  '))}`);
			console.log('');
			console.log(`  ${dim(`Expires in ${expiresIn} minutes. Enter this code in Guardian.`)}`);
			console.log(
				`  ${dim(`Open Guardian → click ${chalk.reset('Receive')} on the signer card.`)}`,
			);
			console.log('');
			console.log(
				`  ${success('✓')} ${dim('The code is single-use. Once claimed, it cannot be reused.')}`,
			);
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
