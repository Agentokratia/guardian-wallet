import type { HttpClient } from './http-client.js';

// ---------------------------------------------------------------------------
// Response types — single source of truth for API shapes
// ---------------------------------------------------------------------------

export interface HealthStatus {
	status: string;
	uptime?: number;
	shareStore?: { connected: boolean; provider?: string };
	vault?: { connected: boolean };
	db?: boolean;
	database?: { connected?: boolean; status?: string };
	auxInfoPool?: { ready: number; total: number };
}

export interface SignerInfo {
	id: string;
	name: string;
	ethAddress: string;
	chain: string;
	network: string;
	status: string;
	dkgCompleted: boolean;
	createdAt: string;
	lastActiveAt?: string;
	balance?: string;
	policyCount?: number;
}

export interface NetworkBalance {
	network: string;
	chainId: number;
	balance: string;
	rpcError?: boolean;
}

export interface BalanceResult {
	address: string;
	balances: NetworkBalance[];
}

export interface TokenBalance {
	symbol: string;
	balance: string;
	decimals: number;
}

export interface NetworkInfo {
	name: string;
	displayName: string;
	chainId: number;
	rpcUrl: string;
	explorerUrl: string | null;
	nativeCurrency: string;
	isTestnet: boolean;
}

export interface TokenInfo {
	id: string;
	address: string;
	symbol: string;
	name: string;
	decimals: number;
	chainId: number;
}

export interface PolicyCriterion {
	type: string;
	[key: string]: unknown;
}

export interface PolicyRule {
	action: 'accept' | 'reject';
	criteria: PolicyCriterion[];
	description?: string;
	enabled?: boolean;
}

export interface PolicyInfo {
	rules: PolicyRule[];
	description?: string | null;
	version?: number;
}

export interface AuditEntry {
	createdAt: string;
	status: string;
	requestType: string;
	signingPath: string;
	toAddress?: string;
	valueWei?: string;
	decodedAction?: string;
	txHash?: string;
	policyViolations?: Array<{ type: string; reason?: string }>;
}

export interface AuditMeta {
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}

export interface AuditResult {
	entries: AuditEntry[];
	meta?: AuditMeta;
}

export interface AuditOpts {
	limit?: number;
	page?: number;
	status?: 'all' | 'completed' | 'blocked' | 'failed';
}

export interface SimulateRequest {
	to: string;
	value?: string;
	data?: string;
	network: string;
}

export interface SimulateResult {
	success: boolean;
	estimatedGas: string;
	gasCostEth: string;
	error?: string;
}

export interface ResolvedAddress {
	address: `0x${string}`;
	isEns: boolean;
	ensName?: string;
}

export interface ResolvedToken {
	address: `0x${string}`;
	symbol: string;
	decimals: number;
	resolvedBySymbol: boolean;
}

// ---------------------------------------------------------------------------
// GuardianApi — all server read operations in one place
// ---------------------------------------------------------------------------

const NETWORK_CACHE_TTL = 60_000;

export class GuardianApi {
	private cachedNetworks: NetworkInfo[] = [];
	private lastNetworkFetch = 0;

	constructor(private client: HttpClient) {}

	// -- Health ---------------------------------------------------------------

	async getHealth(): Promise<HealthStatus> {
		try {
			return await this.client.get<HealthStatus>('/health');
		} catch {
			return await this.client.get<HealthStatus>('/api/v1/health');
		}
	}

	// -- Signers --------------------------------------------------------------

	async listSigners(): Promise<SignerInfo[]> {
		return this.client.get<SignerInfo[]>('/api/v1/signers');
	}

	async getDefaultSigner(): Promise<SignerInfo> {
		const signers = await this.listSigners();
		if (!signers.length) {
			throw new Error('No signers found. Create one from the Guardian dashboard.');
		}
		return signers[0] as SignerInfo;
	}

	// -- Balances -------------------------------------------------------------

	async getBalance(signerId: string, network: string): Promise<BalanceResult> {
		return this.client.get<BalanceResult>(
			`/api/v1/signers/${signerId}/balance?network=${encodeURIComponent(network)}`,
		);
	}

	async getTokenBalances(signerId: string, chainId: number): Promise<TokenBalance[]> {
		return this.client.get<TokenBalance[]>(
			`/api/v1/signers/${signerId}/token-balances?chainId=${chainId}`,
		);
	}

	// -- Networks (cached 60s) ------------------------------------------------

	async listNetworks(): Promise<NetworkInfo[]> {
		if (this.cachedNetworks.length && Date.now() - this.lastNetworkFetch < NETWORK_CACHE_TTL) {
			return this.cachedNetworks;
		}
		try {
			const networks = await this.client.get<NetworkInfo[]>('/api/v1/networks');
			if (Array.isArray(networks) && networks.length) {
				this.cachedNetworks = networks;
				this.lastNetworkFetch = Date.now();
			}
		} catch {
			// Server unreachable — return stale cache or empty
		}
		return this.cachedNetworks;
	}

	async getChainId(network: string): Promise<number> {
		const networks = await this.listNetworks();
		const match = networks.find((n) => n.name === network);
		return match?.chainId || 0;
	}

	async getRpcUrl(network: string): Promise<string> {
		// Per-network env override
		const envKey = `GUARDIAN_RPC_URL_${network.toUpperCase().replace(/-/g, '_')}`;
		const envVal = process.env[envKey];
		if (envVal) return envVal;

		// Global env override
		if (process.env.GUARDIAN_RPC_URL) return process.env.GUARDIAN_RPC_URL;

		// Dynamic from server
		const networks = await this.listNetworks();
		const match = networks.find((n) => n.name === network);
		if (match?.rpcUrl) return match.rpcUrl;

		throw new Error(
			`Unknown network: "${network}". Set GUARDIAN_RPC_URL_${network.toUpperCase().replace(/-/g, '_')} or add it to the server's networks table.`,
		);
	}

	async getExplorerTxUrl(network: string, hash: string): Promise<string> {
		const networks = await this.listNetworks();
		const match = networks.find((n) => n.name === network);
		if (match?.explorerUrl) return `${match.explorerUrl}/tx/${hash}`;
		return hash;
	}

	// -- Tokens ---------------------------------------------------------------

	async listTokens(signerId: string, chainId: number): Promise<TokenInfo[]> {
		return this.client.get<TokenInfo[]>(`/api/v1/signers/${signerId}/tokens?chainId=${chainId}`);
	}

	async resolveToken(
		tokenAddressOrSymbol: string,
		signerId: string,
		chainId: number,
	): Promise<ResolvedToken> {
		// Already a hex address
		if (/^0x[0-9a-fA-F]{40}$/i.test(tokenAddressOrSymbol)) {
			return {
				address: tokenAddressOrSymbol as `0x${string}`,
				symbol: '',
				decimals: 0,
				resolvedBySymbol: false,
			};
		}

		// Symbol lookup via server's tracked tokens
		const tokens = await this.listTokens(signerId, chainId);
		const symbol = tokenAddressOrSymbol.toUpperCase();
		const match = tokens.find((t) => t.symbol.toUpperCase() === symbol);

		if (!match) {
			const available = tokens.map((t) => t.symbol).join(', ');
			throw new Error(
				`Unknown token "${tokenAddressOrSymbol}" on chain ${chainId}. ${
					available
						? `Available tokens: ${available}`
						: 'No tokens tracked — add tokens via the dashboard or provide the contract address.'
				}`,
			);
		}

		return {
			address: match.address as `0x${string}`,
			symbol: match.symbol,
			decimals: match.decimals,
			resolvedBySymbol: true,
		};
	}

	// -- Policies -------------------------------------------------------------

	async getPolicies(signerId: string): Promise<PolicyInfo> {
		try {
			return await this.client.get<PolicyInfo>(`/api/v1/signers/${signerId}/policy`);
		} catch {
			const legacy = await this.client.get<PolicyRule[]>(`/api/v1/signers/${signerId}/policies`);
			return { rules: Array.isArray(legacy) ? legacy : [], description: null };
		}
	}

	// -- Audit ----------------------------------------------------------------

	async getAuditLog(opts?: AuditOpts): Promise<AuditResult> {
		const params = new URLSearchParams();
		params.set('limit', String(opts?.limit ?? 20));
		params.set('page', String(opts?.page ?? 1));
		if (opts?.status && opts.status !== 'all') params.set('status', opts.status);

		const result = await this.client.get<
			{ data?: AuditEntry[]; entries?: AuditEntry[]; meta?: AuditMeta } | AuditEntry[]
		>(`/api/v1/audit-log?${params.toString()}`);

		const entries = Array.isArray(result) ? result : (result.data ?? result.entries ?? []);

		const meta = !Array.isArray(result) ? result.meta : undefined;

		return { entries, meta };
	}

	// -- Simulate -------------------------------------------------------------

	async simulate(signerId: string, tx: SimulateRequest): Promise<SimulateResult> {
		return this.client.post<SimulateResult>(`/api/v1/signers/${signerId}/simulate`, tx);
	}

	// -- ENS ------------------------------------------------------------------

	async resolveAddress(addressOrEns: string): Promise<ResolvedAddress> {
		// Already a hex address
		if (/^0x[0-9a-fA-F]{40}$/.test(addressOrEns)) {
			return { address: addressOrEns as `0x${string}`, isEns: false };
		}

		// ENS name
		if (addressOrEns.endsWith('.eth') || addressOrEns.includes('.')) {
			const { http, createPublicClient } = await import('viem');
			const { mainnet } = await import('viem/chains');
			const { normalize } = await import('viem/ens');

			const rpcUrl = process.env.GUARDIAN_RPC_URL_MAINNET || 'https://cloudflare-eth.com';
			const viemClient = createPublicClient({
				chain: mainnet,
				transport: http(rpcUrl),
			});

			const resolved = await viemClient.getEnsAddress({
				name: normalize(addressOrEns),
			});
			if (!resolved) {
				throw new Error(
					`Could not resolve ENS name "${addressOrEns}". Make sure the name exists and has an address record.`,
				);
			}

			return { address: resolved, isEns: true, ensName: addressOrEns };
		}

		throw new Error(
			`Invalid address: "${addressOrEns}". Provide a 0x hex address or an ENS name (e.g. "vitalik.eth").`,
		);
	}

	// -- Cache control --------------------------------------------------------

	clearNetworkCache(): void {
		this.cachedNetworks = [];
		this.lastNetworkFetch = 0;
	}
}
