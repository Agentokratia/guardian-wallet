import { ThresholdSigner } from '@agentokratia/guardian-signer';
import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { loadConfig } from '../config.js';
import { createSignerFromConfig } from '../signer-factory.js';

export const signMessageCommand = new Command('sign-message')
	.description('Sign a message using threshold ECDSA')
	.argument('<message>', 'Message to sign (string or hex with 0x prefix)')
	.action(async (message: string) => {
		let config: ReturnType<typeof loadConfig> | undefined;
		try {
			config = loadConfig();
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : 'Unknown error';
			console.error(chalk.red(`\n  Error: ${msg}\n`));
			process.exitCode = 1;
			return;
		}

		console.log(chalk.bold('\n  Sign Message'));
		console.log(chalk.dim(`  ${'-'.repeat(40)}`));

		const isHex = /^0x[0-9a-fA-F]*$/.test(message);
		if (isHex) {
			console.log(
				`  Message: ${chalk.dim(message.slice(0, 40))}${message.length > 40 ? '...' : ''}`,
			);
		} else {
			console.log(
				`  Message: ${chalk.dim(`"${message.slice(0, 60)}"`)}${message.length > 60 ? '...' : ''}`,
			);
		}
		console.log('');

		const spinner = ora({ text: 'Loading keyshare...', indent: 2 }).start();

		let signer: ThresholdSigner | undefined;

		try {
			signer = await createSignerFromConfig(config);

			spinner.text = 'Signing message (threshold ECDSA)...';

			const result = await signer.signMessage(message);

			spinner.succeed('Message signed successfully');

			console.log('');
			console.log(`  ${chalk.bold('v:')} ${result.v}`);
			console.log(`  ${chalk.bold('r:')} ${chalk.cyan(result.r)}`);
			console.log(`  ${chalk.bold('s:')} ${chalk.cyan(result.s)}`);
			console.log(`  ${chalk.bold('sig:')} ${chalk.dim(result.signature)}`);
			console.log('');
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : 'Unknown error';
			spinner.fail(`Signing failed: ${msg}`);
			process.exitCode = 1;
		} finally {
			if (signer) {
				signer.destroy();
			}
		}
	});
