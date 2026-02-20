import type { ThresholdSigner } from '@agentokratia/guardian-signer';
import chalk from 'chalk';
import { Command, type Command as CommandType } from 'commander';
import ora from 'ora';
import { parseEther } from 'viem';
import {
	type SignerConfig,
	createClientFromConfig,
	createSignerFromConfig,
	loadSignerConfig,
} from '../../lib/config.js';
import { brand, danger, dim } from '../theme.js';

export const sendCommand = new Command('send')
	.description('Send ETH to an address')
	.argument('<to>', 'Destination address (0x...)')
	.argument('<amount>', 'Amount in ETH (e.g., 0.01)')
	.option('-n, --network <network>', 'Override default network')
	.option('--gas-limit <limit>', 'Gas limit')
	.option('--data <hex>', 'Calldata as hex string')
	.action(
		async (
			to: string,
			amount: string,
			options: { network?: string; gasLimit?: string; data?: string },
			command: CommandType,
		) => {
			if (!/^0x[0-9a-fA-F]{40}$/.test(to)) {
				console.error(danger('\n  Error: Invalid Ethereum address format.\n'));
				process.exitCode = 1;
				return;
			}

			const amountFloat = Number.parseFloat(amount);
			if (Number.isNaN(amountFloat) || amountFloat <= 0) {
				console.error(danger('\n  Error: Amount must be a positive number.\n'));
				process.exitCode = 1;
				return;
			}

			let config: SignerConfig;
			try {
				config = loadSignerConfig(command.optsWithGlobals().signer);
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : 'Unknown error';
				console.error(danger(`\n  Error: ${message}\n`));
				process.exitCode = 1;
				return;
			}

			const network = options.network ?? config.network;
			if (!network) {
				console.error(danger('\n  Error: No network specified. Use --network <name>.\n'));
				process.exitCode = 1;
				return;
			}
			const valueWei = parseEther(amount).toString();
			const { api } = createClientFromConfig(config);

			console.log(chalk.bold('\n  Transaction Details'));
			console.log(dim(`  ${'-'.repeat(40)}`));
			console.log(`  To:      ${brand(to)}`);
			console.log(`  Amount:  ${chalk.bold(amount)} ETH (${valueWei} wei)`);
			console.log(`  Network: ${network}`);
			if (options.gasLimit) console.log(`  Gas:     ${options.gasLimit}`);
			if (options.data) console.log(`  Data:    ${options.data.slice(0, 20)}...`);
			console.log('');

			const spinner = ora({ text: 'Loading keyshare...', indent: 2 }).start();

			let signer: ThresholdSigner | undefined;

			try {
				signer = await createSignerFromConfig(config);
				spinner.text = 'Signing transaction (threshold ECDSA)...';

				const transaction: Record<string, unknown> = { to, value: valueWei, network };
				if (options.gasLimit) transaction.gasLimit = options.gasLimit;
				if (options.data) transaction.data = options.data;

				const result = await signer.signTransaction(transaction);

				spinner.succeed('Transaction signed and broadcast');

				const explorerUrl = await api.getExplorerTxUrl(network, result.txHash);

				console.log('');
				console.log(`  ${chalk.bold('Tx Hash:')} ${brand(result.txHash)}`);
				if (explorerUrl) {
					console.log(`  ${chalk.bold('Explorer:')} ${dim(explorerUrl)}`);
				}
				console.log('');
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : 'Unknown error';
				spinner.fail(`Transaction failed: ${message}`);
				process.exitCode = 1;
			} finally {
				signer?.destroy();
			}
		},
	);
