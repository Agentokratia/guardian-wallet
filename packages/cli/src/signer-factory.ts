import { DKLs23Scheme } from '@agentokratia/guardian-schemes';
import { ThresholdSigner } from '@agentokratia/guardian-signer';
import { type TwConfig, resolveApiSecret } from './config.js';

/**
 * Create a ThresholdSigner from the CLI config.
 *
 * Resolves the API secret from either inline `apiSecret` or `apiSecretFile`.
 */
export async function createSignerFromConfig(config: TwConfig): Promise<ThresholdSigner> {
	return ThresholdSigner.fromSecret({
		apiSecret: resolveApiSecret(config),
		serverUrl: config.serverUrl,
		apiKey: config.apiKey,
		scheme: new DKLs23Scheme(),
	});
}
