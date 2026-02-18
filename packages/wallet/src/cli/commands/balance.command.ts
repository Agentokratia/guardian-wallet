import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { formatUnits } from 'viem';
import { createClientFromConfig, loadConfig } from '../../lib/config.js';

export const balanceCommand = new Command('balance')
	.description('Show ETH balance for the configured signer')
	.option('-n, --network <network>', 'Override default network')
	.action(async (options: { network?: string }) => {
		const spinner = ora({ text: 'Loading configuration...', indent: 2 }).start();

		let config: ReturnType<typeof loadConfig> | undefined;
		try {
			config = loadConfig();
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			spinner.fail(message);
			process.exitCode = 1;
			return;
		}

		const network = options.network ?? config.network;
		spinner.text = `Fetching balance on ${network}...`;

		const { api } = createClientFromConfig(config);

		try {
			const signer = await api.getDefaultSigner();
			const bal = await api.getBalance(signer.id, network);

			spinner.succeed(`Balance on ${network}`);
			console.log('');
			console.log(`  ${chalk.bold(signer.name)}`);
			console.log(`  Address:  ${chalk.cyan(signer.ethAddress)}`);

			if (bal.balances.length === 0) {
				console.log(`  ${chalk.yellow('  No balance data available')}`);
			} else {
				for (const nb of bal.balances) {
					const ethDisplay = formatUnits(BigInt(nb.balance), 18);
					const label = `  ${nb.network}:`;
					if (nb.rpcError) {
						console.log(`${label.padEnd(20)}${chalk.yellow('RPC error')}`);
					} else {
						console.log(`${label.padEnd(20)}${chalk.bold(ethDisplay)} ETH`);
					}
				}
			}

			console.log(
				`  Status:   ${signer.status === 'active' ? chalk.green(signer.status) : chalk.yellow(signer.status)}`,
			);

			const explorerUrl = await api.getExplorerTxUrl(network, signer.ethAddress);
			if (explorerUrl) {
				console.log(`  Explorer: ${chalk.dim(explorerUrl)}`);
			}
			console.log('');
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			spinner.fail(`Failed to fetch balance: ${message}`);
			process.exitCode = 1;
		}
	});
