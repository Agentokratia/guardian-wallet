import { HttpClient } from '@agentokratia/guardian-signer';
import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { loadConfig } from '../config.js';
import { formatWeiToEth } from '../formatting.js';

interface SignerResponse {
	readonly id: string;
	readonly name: string;
	readonly ethAddress: string;
	readonly chain: string;
	readonly network: string;
	readonly status: string;
	readonly dkgCompleted: boolean;
	readonly createdAt: string;
	readonly lastActiveAt?: string;
}

interface SignerDetailResponse extends SignerResponse {
	readonly balance?: string;
	readonly policyCount?: number;
}

function statusColor(status: string): string {
	switch (status) {
		case 'active':
			return chalk.green(status);
		case 'paused':
			return chalk.yellow(status);
		case 'revoked':
			return chalk.red(status);
		default:
			return chalk.dim(status);
	}
}

function formatAddress(address: string): string {
	if (address.length <= 12) return address;
	return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatBalance(weiStr: string | undefined): string {
	if (!weiStr) return chalk.dim('--');
	return `${formatWeiToEth(weiStr)} ETH`;
}

export const statusCommand = new Command('status')
	.description('Display signer info and connection status')
	.action(async () => {
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

		spinner.text = 'Connecting to server...';

		const client = new HttpClient({
			baseUrl: config.serverUrl,
			apiKey: config.apiKey,
		});

		try {
			const signers = await client.get<SignerDetailResponse[]>('/api/v1/signers');

			spinner.succeed(`Connected to ${config.serverUrl}`);
			console.log('');

			if (signers.length === 0) {
				console.log(chalk.dim('  No signers found. Create one from the dashboard.\n'));
				return;
			}

			// Table header
			const header = [
				chalk.bold('  Name'.padEnd(18)),
				chalk.bold('Address'.padEnd(14)),
				chalk.bold('Chain'.padEnd(12)),
				chalk.bold('Network'.padEnd(14)),
				chalk.bold('Status'.padEnd(12)),
				chalk.bold('Balance'.padEnd(16)),
				chalk.bold('Policies'),
			].join('');

			console.log(header);
			console.log(chalk.dim(`  ${'-'.repeat(96)}`));

			for (const signer of signers) {
				const row = [
					`  ${signer.name}`.padEnd(18),
					formatAddress(signer.ethAddress).padEnd(14),
					signer.chain.padEnd(12),
					signer.network.padEnd(14),
					statusColor(signer.status).padEnd(12 + 10), // account for chalk escape codes
					formatBalance(signer.balance).padEnd(16 + 10),
					String(signer.policyCount ?? '--'),
				].join('');

				console.log(row);
			}

			console.log('');
			console.log(chalk.dim(`  ${signers.length} signer(s) total`));
			console.log(chalk.dim(`  Network: ${config.network}\n`));
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			spinner.fail(`Failed to connect: ${message}`);
			process.exitCode = 1;
		}
	});
