import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { base, baseSepolia, mainnet, sepolia } from 'wagmi/chains';

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '';
if (!projectId) console.warn('VITE_WALLETCONNECT_PROJECT_ID env var is not set. WalletConnect may not work.');

export const wagmiConfig = getDefaultConfig({
	appName: 'Guardian by Agentokratia',
	projectId,
	chains: [baseSepolia, base, mainnet, sepolia],
});
