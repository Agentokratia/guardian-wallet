import { HttpClient } from '@agentokratia/guardian-signer';
import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { loadConfig } from '../config.js';
import { formatWeiToEth } from '../formatting.js';
import { getExplorerAddressUrl } from '../networks.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SignerResponse {
	readonly id: string;
	readonly name: string;
	readonly ethAddress: string;
	readonly chain: string;
	readonly network: string;
	readonly status: string;
}

interface NetworkBalance {
	readonly network: string;
	readonly chainId: number;
	readonly balance: string;
	readonly rpcError?: boolean;
}

interface BalanceResponse {
	readonly address: string;
	readonly balances: NetworkBalance[];
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

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

		const client = new HttpClient({
			baseUrl: config.serverUrl,
			apiKey: config.apiKey,
		});

		try {
			// API key is bound to a single signer
			const signers = await client.get<SignerResponse[]>('/api/v1/signers');

			if (signers.length === 0) {
				spinner.succeed('No signers found');
				console.log(chalk.dim('\n  Create one from the dashboard.\n'));
				return;
			}

			const signer = signers[0]!;
			const bal = await client.get<BalanceResponse>(
				`/api/v1/signers/${signer.id}/balance?network=${encodeURIComponent(network)}`,
			);

			spinner.succeed(`Balance on ${network}`);
			console.log('');
			console.log(`  ${chalk.bold(signer.name)}`);
			console.log(`  Address:  ${chalk.cyan(signer.ethAddress)}`);

			if (bal.balances.length === 0) {
				console.log(`  ${chalk.yellow('  No balance data available')}`);
			} else {
				for (const nb of bal.balances) {
					const ethDisplay = formatWeiToEth(nb.balance);
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

			const explorerUrl = getExplorerAddressUrl(network, signer.ethAddress);
			if (explorerUrl !== signer.ethAddress) {
				console.log(`  Explorer: ${chalk.dim(explorerUrl)}`);
			}
			console.log('');
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			spinner.fail(`Failed to fetch balance: ${message}`);
			process.exitCode = 1;
		}
	});
