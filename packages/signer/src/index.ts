// Classes
export { ThresholdSigner } from './threshold-signer.js';
export { HttpClient, HttpClientError } from './http-client.js';
export { GuardianApi } from './guardian-api.js';
export { Guardian } from './guardian.js';

// Functions (share-loader)
export { saveShareToFile, loadShareFromFile, wipeShare } from './share-loader.js';

// Types — ThresholdSigner
export type {
	FromFileOptions,
	FromSecretOptions,
	SignMessageResult,
	SignTransactionResult,
	ViemAccount,
} from './threshold-signer.js';

// Types — HttpClient
export type {
	CompleteMessageSignResponse,
	CompleteSignRequest,
	CompleteSignResponse,
	CreateMessageSignSessionRequest,
	CreateMessageSignSessionResponse,
	CreateSignSessionRequest,
	CreateSignSessionResponse,
	HttpClientConfig,
	HttpErrorBody,
	ProcessSignRoundRequest,
	ProcessSignRoundResponse,
} from './http-client.js';

// Types — GuardianApi
export type {
	AuditEntry,
	AuditMeta,
	AuditOpts,
	AuditResult,
	BalanceResult,
	HealthStatus,
	NetworkBalance,
	NetworkInfo,
	PolicyInfo,
	PolicyRule,
	ResolvedAddress,
	ResolvedToken,
	SignerInfo,
	SimulateRequest,
	SimulateResult,
	TokenBalance,
	TokenInfo,
} from './guardian-api.js';

// Types — Guardian
export type { GuardianConnectOptions } from './guardian.js';
