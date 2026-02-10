// Classes
export { ThresholdSigner } from './threshold-signer.js';
export { HttpClient, HttpClientError } from './http-client.js';

// Functions (share-loader)
export { saveShareToFile, loadShareFromFile, wipeShare } from './share-loader.js';

// Types
export type {
	FromFileOptions,
	FromSecretOptions,
	SignMessageResult,
	SignTransactionResult,
	ViemAccount,
} from './threshold-signer.js';

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
