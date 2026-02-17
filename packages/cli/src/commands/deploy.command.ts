import { existsSync, readFileSync } from 'node:fs';
import type { ThresholdSigner } from '@agentokratia/guardian-signer';
import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { loadConfig } from '../config.js';
import { getExplorerTxUrl } from '../networks.js';
import { createSignerFromConfig } from '../signer-factory.js';

function isHexString(value: string): boolean {
	const clean = value.startsWith('0x') ? value.slice(2) : value;
	return /^[0-9a-fA-F]*$/.test(clean) && clean.length > 0 && clean.length % 2 === 0;
}

function loadBytecode(bytecodeArg: string): string {
	if (existsSync(bytecodeArg)) {
		const content = readFileSync(bytecodeArg, 'utf-8').trim();
		if (!isHexString(content)) {
			throw new Error('File does not contain valid hex bytecode.');
		}
		return content.startsWith('0x') ? content : `0x${content}`;
	}

	if (!isHexString(bytecodeArg)) {
		throw new Error(
			'Bytecode must be a valid hex string or a path to a file containing hex bytecode.',
		);
	}

	return bytecodeArg.startsWith('0x') ? bytecodeArg : `0x${bytecodeArg}`;
}

export const deployCommand = new Command('deploy')
	.description('Deploy a smart contract')
	.argument('<bytecode>', 'Contract bytecode (hex string or file path)')
	.option('-n, --network <network>', 'Override default network')
	.option('--constructor-args <args>', 'ABI-encoded constructor arguments (hex)')
	.action(
		async (
			bytecodeArg: string,
			options: {
				network?: string;
				constructorArgs?: string;
			},
		) => {
			let config: ReturnType<typeof loadConfig> | undefined;
			try {
				config = loadConfig();
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : 'Unknown error';
				console.error(chalk.red(`\n  Error: ${message}\n`));
				process.exitCode = 1;
				return;
			}

			let bytecode: string;
			try {
				bytecode = loadBytecode(bytecodeArg);
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : 'Unknown error';
				console.error(chalk.red(`\n  Error: ${message}\n`));
				process.exitCode = 1;
				return;
			}

			if (options.constructorArgs) {
				const args = options.constructorArgs.startsWith('0x')
					? options.constructorArgs.slice(2)
					: options.constructorArgs;
				bytecode = `${bytecode}${args}`;
			}

			const network = options.network ?? config.network;

			console.log(chalk.bold('\n  Contract Deployment'));
			console.log(chalk.dim(`  ${'-'.repeat(40)}`));
			console.log(`  Network:  ${network}`);
			console.log(
				`  Bytecode: ${chalk.dim(bytecode.slice(0, 24))}...${chalk.dim(`(${bytecode.length} chars)`)}`,
			);
			if (options.constructorArgs) {
				console.log(`  Args:     ${chalk.dim(options.constructorArgs.slice(0, 24))}...`);
			}
			console.log('');

			const spinner = ora({ text: 'Loading keyshare...', indent: 2 }).start();

			let signer: ThresholdSigner | undefined;

			try {
				signer = await createSignerFromConfig(config);

				spinner.text = 'Deploying contract (threshold ECDSA)...';

				const transaction: Record<string, unknown> = {
					to: null,
					data: bytecode,
					value: '0',
					network,
				};

				const result = await signer.signTransaction(transaction);

				spinner.succeed('Contract deployed successfully');

				console.log('');
				console.log(`  ${chalk.bold('Tx Hash:')}  ${chalk.cyan(result.txHash)}`);

				const txExplorer = getExplorerTxUrl(network, result.txHash);

				if (txExplorer !== result.txHash) {
					console.log(`  ${chalk.bold('Tx URL:')}   ${chalk.dim(txExplorer)}`);
				}
				console.log('');
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : 'Unknown error';
				spinner.fail(`Deployment failed: ${message}`);
				process.exitCode = 1;
			} finally {
				if (signer) {
					signer.destroy();
				}
			}
		},
	);
