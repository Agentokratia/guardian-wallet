import { Command } from 'commander';
import { balanceCommand } from './commands/balance.command.js';
import { deployCommand } from './commands/deploy.command.js';
import { initCommand } from './commands/init.command.js';
import { proxyCommand } from './commands/proxy.command.js';
import { sendCommand } from './commands/send.command.js';
import { signMessageCommand } from './commands/sign.command.js';
import { statusCommand } from './commands/status.command.js';

export async function runCli(): Promise<void> {
	const program = new Command();

	program
		.name('guardian-wallet')
		.description('Guardian Wallet — Agent key infrastructure. The key never exists.')
		.version('0.1.0');

	program.addCommand(initCommand);
	program.addCommand(statusCommand);
	program.addCommand(balanceCommand);
	program.addCommand(sendCommand);
	program.addCommand(signMessageCommand);
	program.addCommand(deployCommand);
	program.addCommand(proxyCommand);

	await program.parseAsync();
}
