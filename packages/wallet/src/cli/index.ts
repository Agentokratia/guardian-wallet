import { Command } from 'commander';
import { adminCommand } from './commands/admin.command.js';
import { balanceCommand } from './commands/balance.command.js';
import { deployCommand } from './commands/deploy.command.js';
import { infoCommand } from './commands/info.command.js';
import { initCommand } from './commands/init.command.js';
import { proxyCommand } from './commands/proxy.command.js';
import { sendCommand } from './commands/send.command.js';
import { signMessageCommand } from './commands/sign.command.js';
import { statusCommand } from './commands/status.command.js';
import { BRAND_BANNER, dim } from './theme.js';

export async function runCli(): Promise<void> {
	const program = new Command();

	program
		.name('gw')
		.description(BRAND_BANNER)
		.version('0.1.0')
		.option('-s, --signer <name>', 'Signer name (default: auto-detected)')
		.addHelpText(
			'after',
			`
${dim('Getting started:')}
  $ gw init              Create your first wallet
  $ gw status            See all your wallets
  $ gw send 0x... 0.01   Send ETH
  $ gw admin unlock      Enable admin access (policies, pause/resume)

${dim('Docs: https://github.com/agentokratia/guardian-wallet')}
`,
		);

	program.addCommand(initCommand);
	program.addCommand(statusCommand);
	program.addCommand(infoCommand);
	program.addCommand(balanceCommand);
	program.addCommand(sendCommand);
	program.addCommand(signMessageCommand);
	program.addCommand(deployCommand);
	program.addCommand(proxyCommand);
	program.addCommand(adminCommand);

	await program.parseAsync();
}
