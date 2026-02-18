import { CGGMP24Scheme } from '@agentokratia/guardian-schemes';
import { GuardianApi } from './guardian-api.js';
import type {
	AuditOpts,
	AuditResult,
	BalanceResult,
	HealthStatus,
	NetworkInfo,
	PolicyInfo,
	ResolvedAddress,
	ResolvedToken,
	SignerInfo,
	SimulateRequest,
	SimulateResult,
	TokenBalance,
	TokenInfo,
} from './guardian-api.js';
import { HttpClient } from './http-client.js';
import { ThresholdSigner } from './threshold-signer.js';
import type { SignMessageResult, SignTransactionResult, ViemAccount } from './threshold-signer.js';

// ---------------------------------------------------------------------------
// Connect options
// ---------------------------------------------------------------------------

export interface GuardianConnectOptions {
	/** Base64-encoded key share (JSON: { coreShare, auxInfo }) */
	apiSecret: string;
	/** Guardian server URL (e.g. "http://localhost:8080") */
	serverUrl: string;
	/** API key for authentication */
	apiKey: string;
}

// ---------------------------------------------------------------------------
// Guardian — flat composition facade
// ---------------------------------------------------------------------------

export class Guardian {
	private _signer: ThresholdSigner;
	private _api: GuardianApi;

	private constructor(signer: ThresholdSigner, api: GuardianApi) {
		this._signer = signer;
		this._api = api;
	}

	/**
	 * Connect to the Guardian server and load key material.
	 * Returns a fully-initialized Guardian instance with all methods available.
	 */
	static async connect(opts: GuardianConnectOptions): Promise<Guardian> {
		const client = new HttpClient({
			baseUrl: opts.serverUrl,
			apiKey: opts.apiKey,
		});
		const api = new GuardianApi(client);
		const signer = await ThresholdSigner.fromSecret({
			apiSecret: opts.apiSecret,
			serverUrl: opts.serverUrl,
			apiKey: opts.apiKey,
			scheme: new CGGMP24Scheme(),
		});
		return new Guardian(signer, api);
	}

	// -- Signing (delegates to ThresholdSigner) --------------------------------

	get address(): string {
		return this._signer.address;
	}

	get participantIndex(): number {
		return this._signer.participantIndex;
	}

	get isDestroyed(): boolean {
		return this._signer.isDestroyed;
	}

	signTransaction(tx: Record<string, unknown>): Promise<SignTransactionResult> {
		return this._signer.signTransaction(tx);
	}

	signMessage(message: string | Record<string, unknown>): Promise<SignMessageResult> {
		return this._signer.signMessage(message);
	}

	toViemAccount(): ViemAccount {
		return this._signer.toViemAccount();
	}

	// -- Read operations (delegates to GuardianApi) ----------------------------

	getHealth(): Promise<HealthStatus> {
		return this._api.getHealth();
	}

	listSigners(): Promise<SignerInfo[]> {
		return this._api.listSigners();
	}

	getDefaultSigner(): Promise<SignerInfo> {
		return this._api.getDefaultSigner();
	}

	getBalance(signerId: string, network: string): Promise<BalanceResult> {
		return this._api.getBalance(signerId, network);
	}

	getTokenBalances(signerId: string, chainId: number): Promise<TokenBalance[]> {
		return this._api.getTokenBalances(signerId, chainId);
	}

	listNetworks(): Promise<NetworkInfo[]> {
		return this._api.listNetworks();
	}

	getChainId(network: string): Promise<number> {
		return this._api.getChainId(network);
	}

	getRpcUrl(network: string): Promise<string> {
		return this._api.getRpcUrl(network);
	}

	getExplorerTxUrl(network: string, hash: string): Promise<string | null> {
		return this._api.getExplorerTxUrl(network, hash);
	}

	listTokens(signerId: string, chainId: number): Promise<TokenInfo[]> {
		return this._api.listTokens(signerId, chainId);
	}

	resolveToken(
		tokenAddressOrSymbol: string,
		signerId: string,
		chainId: number,
	): Promise<ResolvedToken> {
		return this._api.resolveToken(tokenAddressOrSymbol, signerId, chainId);
	}

	getPolicies(signerId: string): Promise<PolicyInfo> {
		return this._api.getPolicies(signerId);
	}

	getAuditLog(opts?: AuditOpts): Promise<AuditResult> {
		return this._api.getAuditLog(opts);
	}

	simulate(signerId: string, tx: SimulateRequest): Promise<SimulateResult> {
		return this._api.simulate(signerId, tx);
	}

	resolveAddress(addressOrEns: string): Promise<ResolvedAddress> {
		return this._api.resolveAddress(addressOrEns);
	}

	// -- Cleanup --------------------------------------------------------------

	destroy(): void {
		this._signer.destroy();
	}
}
