import { sha256 } from '@noble/hashes/sha256';
import { startAuthentication, startRegistration, WebAuthnAbortService } from '@simplewebauthn/browser';
import type {
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import type {
	WebAuthnAuthOptions,
	WebAuthnAuthResult,
	WebAuthnRegistrationOptions,
	WebAuthnRegistrationResult,
} from '../shared/types.js';

/** PRF salt: SHA-256("guardian-prf-v1") */
const PRF_SALT = sha256(new TextEncoder().encode('guardian-prf-v1'));

/**
 * Check whether the browser supports WebAuthn with the PRF extension.
 */
export async function isPRFSupported(): Promise<boolean> {
	if (typeof window === 'undefined' || typeof window.PublicKeyCredential === 'undefined') {
		return false;
	}

	// Check for PRF extension support via getClientCapabilities if available
	const pkc = window.PublicKeyCredential as unknown as Record<string, unknown>;
	if (typeof pkc.getClientCapabilities === 'function') {
		try {
			const capabilities = await (
				pkc.getClientCapabilities as () => Promise<Map<string, boolean>>
			)();
			return capabilities.get('prf') === true;
		} catch {
			// Fall through to feature detection
		}
	}

	// Fallback: assume PRF might be supported if conditional mediation is available
	if (typeof pkc.isConditionalMediationAvailable === 'function') {
		return true;
	}

	return false;
}

/**
 * PRF extension object with the salt as a raw ArrayBuffer.
 * startRegistration/startAuthentication pass extensions through to the
 * browser API without conversion, so the salt MUST be an ArrayBuffer
 * (not a base64url string).
 */
function prfExtension(): Record<string, unknown> {
	// .slice() creates a new Uint8Array with its own ArrayBuffer,
	// guaranteeing byteOffset=0 and exact length (browser API is strict).
	const salt = PRF_SALT.slice();
	return {
		prf: {
			eval: {
				first: salt.buffer,
			},
		},
	};
}

/**
 * Register a new passkey with the PRF extension enabled.
 * Accepts either the raw server options (PublicKeyCredentialCreationOptionsJSON)
 * or the legacy WebAuthnRegistrationOptions shape.
 * Returns credential info and (if supported) the PRF output for wallet derivation.
 */
export async function registerPasskeyWithPRF(
	options: WebAuthnRegistrationOptions | PublicKeyCredentialCreationOptionsJSON,
): Promise<WebAuthnRegistrationResult> {
	let publicKeyOptions: PublicKeyCredentialCreationOptionsJSON;

	if ('rp' in options && 'user' in options && 'challenge' in options) {
		// Server-generated PublicKeyCredentialCreationOptionsJSON — use directly
		publicKeyOptions = {
			...options,
			extensions: {
				...(options.extensions ?? {}),
				...(prfExtension()),
			} as PublicKeyCredentialCreationOptionsJSON['extensions'],
		};
	} else {
		// Legacy WebAuthnRegistrationOptions shape
		const legacy = options as WebAuthnRegistrationOptions;
		publicKeyOptions = {
			rp: {
				id: legacy.rpId,
				name: legacy.rpName,
			},
			user: {
				id: legacy.userId,
				name: legacy.userName,
				displayName: legacy.userDisplayName,
			},
			challenge: legacy.challenge,
			pubKeyCredParams: [
				{ alg: -7, type: 'public-key' },
				{ alg: -257, type: 'public-key' },
			],
			authenticatorSelection: {
				residentKey: 'required',
				userVerification: 'required',
			},
			excludeCredentials: legacy.excludeCredentialIds?.map((id) => ({
				id,
				type: 'public-key' as const,
			})),
			extensions: prfExtension() as unknown as PublicKeyCredentialCreationOptionsJSON['extensions'],
		};
	}

	// Cancel any stale ceremony from a previous (possibly failed/cancelled) call.
	// WebAuthnAbortService is a singleton — if a previous controller exists it will
	// abort the *new* ceremony the moment startRegistration calls createNewAbortSignal().
	WebAuthnAbortService.cancelCeremony();

	const result = await startRegistration({ optionsJSON: publicKeyOptions });

	// Extract PRF output from extension results if available
	const prfResults = (result.clientExtensionResults as Record<string, unknown>)?.prf as
		| { results?: { first?: ArrayBuffer } }
		| undefined;

	const prfOutput = prfResults?.results?.first
		? new Uint8Array(prfResults.results.first)
		: undefined;

	return {
		credentialId: result.id,
		publicKeyCose: result.response.publicKey ?? '',
		counter: 0,
		prfOutput,
		deviceType: result.response.authenticatorData ? 'platform' : 'cross-platform',
		registrationResponseJSON: result,
	};
}

/**
 * Authenticate with an existing passkey and the PRF extension.
 * Returns credential info and (if supported) the PRF output.
 */
export async function authenticateWithPRF(
	options: WebAuthnAuthOptions,
): Promise<WebAuthnAuthResult> {
	const publicKeyOptions: PublicKeyCredentialRequestOptionsJSON = {
		rpId: options.rpId,
		challenge: options.challenge,
		allowCredentials: options.allowCredentialIds.map((id) => ({
			id,
			type: 'public-key' as const,
		})),
		userVerification: 'required',
		extensions: prfExtension() as unknown as PublicKeyCredentialRequestOptionsJSON['extensions'],
	};

	// Cancel any stale ceremony (see registerPasskeyWithPRF comment)
	WebAuthnAbortService.cancelCeremony();

	const result = await startAuthentication({ optionsJSON: publicKeyOptions });

	// Extract PRF output from extension results if available
	const prfResults = (result.clientExtensionResults as Record<string, unknown>)?.prf as
		| { results?: { first?: ArrayBuffer } }
		| undefined;

	const prfOutput = prfResults?.results?.first
		? new Uint8Array(prfResults.results.first)
		: undefined;

	return {
		credentialId: result.id,
		counter: result.response.authenticatorData
			? parseCounterFromAuthData(result.response.authenticatorData)
			: 0,
		prfOutput,
		authenticationResponseJSON: result,
	};
}

/** Parse the signature counter (big-endian uint32 at offset 33) from base64url authenticatorData. */
function parseCounterFromAuthData(authDataBase64url: string): number {
	const binary = atob(authDataBase64url.replace(/-/g, '+').replace(/_/g, '/'));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	// Counter is 4 bytes big-endian starting at offset 33
	if (bytes.length < 37) return 0;
	const view = new DataView(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
	return view.getUint32(33, false);
}
