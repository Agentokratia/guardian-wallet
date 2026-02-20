import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { formatUnits } from 'viem';
import {
	type SignerConfig,
	createClientFromConfig,
	getDefaultSignerName,
	listSigners,
	loadSignerConfig,
} from '../../lib/config.js';
import { brand, brandBold, brandDot, dim, statusColor } from '../theme.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping is intentional
const ANSI_RE = /\u001B\[[0-9;]*m/g;

function pad(str: string, width: number): string {
	const visible = str.replace(ANSI_RE, '');
	return str + ' '.repeat(Math.max(0, width - visible.length));
}

function fmtAddr(address: string): string {
	if (!address || address.length < 10) return dim('—');
	return dim(`${address.slice(0, 6)}…${address.slice(-4)}`);
}

function fmtBal(weiStr: string | undefined): string {
	if (!weiStr || weiStr === '0') return dim('0 ETH');
	const eth = formatUnits(BigInt(weiStr), 18);
	const clean = eth.includes('.') ? eth.replace(/\.?0+$/, '') : eth;
	return `${clean} ETH`;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

interface WalletInfo {
	name: string;
	address: string;
	status: string;
	balance: string | undefined;
	policies: number | undefined;
	isDefault: boolean;
}

async function fetchInfo(name: string, config: SignerConfig): Promise<WalletInfo> {
	const info: WalletInfo = {
		name,
		address: config.ethAddress || '',
		status: 'unknown',
		balance: undefined,
		policies: undefined,
		isDefault: false,
	};

	try {
		const { api } = createClientFromConfig(config);
		const signers = await api.listSigners();
		const [s] = signers;
		if (s) {
			info.status = s.status;
			info.balance = s.balance;
			info.policies = s.policyCount;
			if (s.ethAddress) info.address = s.ethAddress;
		}
	} catch {
		info.status = 'offline';
	}

	return info;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const statusCommand = new Command('status')
	.description('Show all your wallets')
	.action(async () => {
		const names = listSigners();

		if (names.length === 0) {
			console.log(chalk.yellow('\n  No wallets found. Run `gw init` to create one.\n'));
			return;
		}

		const defaultName = getDefaultSignerName();
		const spinner = ora({
			text: `Checking ${names.length} wallet${names.length > 1 ? 's' : ''}…`,
			indent: 2,
		}).start();

		const wallets: WalletInfo[] = await Promise.all(
			names.map(async (name) => {
				try {
					const config = loadSignerConfig(name);
					const info = await fetchInfo(name, config);
					info.isDefault = name === defaultName;
					return info;
				} catch {
					return {
						name,
						address: '',
						status: 'error',
						balance: undefined,
						policies: undefined,
						isDefault: name === defaultName,
					};
				}
			}),
		);

		spinner.stop();

		const nw = Math.max(4, ...wallets.map((w) => w.name.length)) + 3;
		const aw = 15;
		const sw = 10;

		console.log('');

		for (const w of wallets) {
			const dot = brandDot(w.isDefault);
			const name = w.isDefault ? brandBold(w.name) : w.name;
			const addr = fmtAddr(w.address);
			const status = statusColor(w.status);
			const pol = w.policies != null ? dim(`${w.policies} pol`) : '';

			console.log(`  ${dot} ${pad(name, nw)} ${pad(addr, aw)} ${pad(status, sw)} ${pol}`);
		}

		console.log('');
		const activeLabel = defaultName ? brand(defaultName) : dim('none');
		console.log(
			dim('  Active: ') +
				activeLabel +
				dim(` · ${wallets.length} wallet${wallets.length > 1 ? 's' : ''}`),
		);
		console.log(dim(`  Run ${chalk.reset('gw info <name>')} for full details`));
		console.log('');
	});
