import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { type TwConfig, configExists, getConfigPath, saveConfig } from '../config.js';
import { promptHidden } from '../prompt.js';

export const initCommand = new Command('init')
	.description('Interactive setup wizard for Guardian Wallet CLI')
	.action(async () => {
		console.log(chalk.bold('\n  Guardian Wallet CLI Setup\n'));
		console.log(chalk.dim('  Configure your CLI to connect to a Guardian Wallet server.\n'));

		if (configExists()) {
			console.log(chalk.yellow(`  Warning: Config already exists at ${getConfigPath()}`));
			console.log(chalk.yellow('  This wizard will overwrite the existing config.\n'));
		}

		const rl = createInterface({ input: stdin, output: stdout });

		try {
			const serverUrl =
				(
					await rl.question(
						chalk.cyan('  Server URL ') + chalk.dim('(http://localhost:8080)') + chalk.cyan(': '),
					)
				).trim() || 'http://localhost:8080';

			rl.close();

			const apiKey = await promptHidden(
				chalk.cyan('  API key ') + chalk.dim('(hidden)') + chalk.cyan(': '),
			);

			if (!apiKey) {
				console.log(chalk.red('\n  Error: API key is required.'));
				process.exitCode = 1;
				return;
			}

			const rl2 = createInterface({ input: stdin, output: stdout });
			const secretFilePath =
				(
					await rl2.question(
						chalk.cyan('  API secret file ') + chalk.dim('(path to .secret file)') + chalk.cyan(': '),
					)
				).trim();
			rl2.close();

			let apiSecret: string | undefined;
			let apiSecretFile: string | undefined;

			if (secretFilePath) {
				apiSecretFile = secretFilePath;
			} else {
				apiSecret = await promptHidden(
					chalk.cyan('  API secret ') + chalk.dim('(paste base64 keyshare, hidden)') + chalk.cyan(': '),
				);
			}

			if (!apiSecret && !apiSecretFile) {
				console.log(chalk.red('\n  Error: API secret file or value is required.'));
				process.exitCode = 1;
				return;
			}

			const rl3 = createInterface({ input: stdin, output: stdout });
			const network =
				(
					await rl3.question(
						chalk.cyan('  Default network ') + chalk.dim('(base-sepolia)') + chalk.cyan(': '),
					)
				).trim() || 'base-sepolia';
			rl3.close();

			const spinner = ora({
				text: 'Saving configuration...',
				indent: 2,
			}).start();

			const config: TwConfig = {
				serverUrl,
				apiKey,
				...(apiSecretFile ? { apiSecretFile } : { apiSecret }),
				network,
			};

			saveConfig(config);

			spinner.succeed('Configuration saved successfully');

			console.log(chalk.dim(`\n  Config: ${getConfigPath()}`));
			console.log(chalk.dim(`  Server: ${serverUrl}`));
			console.log(chalk.dim(`  Network: ${network}\n`));
			console.log(
				chalk.green('  Run ') +
					chalk.bold('gw status') +
					chalk.green(' to verify your connection.\n'),
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			console.error(chalk.red(`\n  Error: ${message}\n`));
			process.exitCode = 1;
		}
	});
