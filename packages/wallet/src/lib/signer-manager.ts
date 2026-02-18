import { readFileSync } from 'node:fs';
import { CGGMP24Scheme } from '@agentokratia/guardian-schemes';
import { GuardianApi, HttpClient, ThresholdSigner } from '@agentokratia/guardian-signer';

export class SignerManager {
	private signer: ThresholdSigner | null = null;
	private signerPromise: Promise<ThresholdSigner> | null = null;
	private httpClient: HttpClient | null = null;
	private api: GuardianApi | null = null;

	private getConfig() {
		let apiSecret = process.env.GUARDIAN_API_SECRET;
		const secretFile = process.env.GUARDIAN_API_SECRET_FILE;
		const serverUrl = process.env.GUARDIAN_SERVER || 'http://localhost:8080';
		const apiKey = process.env.GUARDIAN_API_KEY;

		if (!apiSecret && secretFile) {
			apiSecret = readFileSync(secretFile, 'utf-8').trim();
		}

		if (!apiSecret) throw new Error('GUARDIAN_API_SECRET is required');
		if (!apiKey) throw new Error('GUARDIAN_API_KEY is required');

		return { apiSecret, serverUrl, apiKey };
	}

	async getSigner(): Promise<ThresholdSigner> {
		if (this.signer && !this.signer.isDestroyed) return this.signer;

		// Prevent concurrent creation — reuse the in-flight promise
		if (this.signerPromise) return this.signerPromise;

		this.signer = null;
		const { apiSecret, serverUrl, apiKey } = this.getConfig();
		this.signerPromise = ThresholdSigner.fromSecret({
			apiSecret,
			serverUrl,
			apiKey,
			scheme: new CGGMP24Scheme(),
		})
			.then((s) => {
				this.signer = s;
				this.signerPromise = null;
				return s;
			})
			.catch((err) => {
				this.signerPromise = null;
				throw err;
			});

		return this.signerPromise;
	}

	getHttpClient(): HttpClient {
		if (this.httpClient) return this.httpClient;

		const { serverUrl, apiKey } = this.getConfig();
		this.httpClient = new HttpClient({ baseUrl: serverUrl, apiKey });
		return this.httpClient;
	}

	getApi(): GuardianApi {
		if (this.api) return this.api;
		this.api = new GuardianApi(this.getHttpClient());
		return this.api;
	}

	/** GUARDIAN_NETWORK — network name matching server's GET /api/v1/networks (e.g. "base-sepolia", "mainnet"). */
	getNetwork(): string | null {
		return process.env.GUARDIAN_NETWORK || null;
	}

	requireNetwork(networkParam?: string): string {
		const network = networkParam || this.getNetwork();
		if (!network) {
			throw new Error(
				'No network specified. Call guardian_list_networks first to see available networks, then pass the "network" parameter to this tool.',
			);
		}
		return network;
	}

	getSignerAddress(): string | undefined {
		return this.signer?.address;
	}

	destroy(): void {
		if (this.signer && !this.signer.isDestroyed) {
			this.signer.destroy();
		}
		this.signer = null;
		this.signerPromise = null;
		this.httpClient = null;
		this.api = null;
	}
}
