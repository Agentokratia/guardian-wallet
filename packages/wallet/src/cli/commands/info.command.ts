import { Command, type Command as CommandType } from 'commander';
import { type SignerConfig, getSignerConfigPath, loadSignerConfig } from '../../lib/config.js';
import { brand, brandBold, dim, failMark } from '../theme.js';

export const infoCommand = new Command('info')
	.description('Show full wallet details (copyable)')
	.argument('[name]', 'Wallet name')
	.action(
		async (name: string | undefined, _options: Record<string, unknown>, command: CommandType) => {
			let config: SignerConfig;
			try {
				config = loadSignerConfig(name ?? command.optsWithGlobals().signer);
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : 'Unknown error';
				console.error(`\n  ${failMark(message)}\n`);
				process.exitCode = 1;
				return;
			}

			console.log('');
			console.log(`  ${brand('●')} ${brandBold(config.signerName)}`);
			console.log('');
			console.log(`  ${dim('Address')}    ${config.ethAddress}`);
			console.log(`  ${dim('API Key')}    ${config.apiKey.slice(0, 12)}…`);
			console.log(`  ${dim('Policy')}     ${config.serverUrl}`);
			if (config.signerId) {
				console.log(`  ${dim('Signer ID')}  ${config.signerId}`);
			}
			console.log(`  ${dim('Config')}     ${getSignerConfigPath(config.signerName)}`);
			console.log('');
		},
	);
