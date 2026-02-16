import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

export interface GenerateRegistrationInput {
	rpId: string;
	rpName: string;
	userId: string;
	userName: string;
	userDisplayName: string;
	excludeCredentialIds?: string[];
}

export interface VerifiedRegistration {
	credentialId: string;
	publicKey: Uint8Array;
	counter: number;
}

export interface GenerateAuthInput {
	rpId: string;
	allowCredentialIds?: string[];
}

export interface VerifyAuthInput {
	response: AuthenticationResponseJSON;
	expectedChallenge: string;
	credentialPublicKey: Uint8Array;
	credentialCounter: number;
	credentialId: string;
	rpId: string;
	origin: string;
}

export interface VerifiedAuth {
	credentialId: string;
	newCounter: number;
}

/**
 * Generate WebAuthn registration options.
 * Returns PublicKeyCredentialCreationOptionsJSON to send to the client.
 */
export async function generateRegistrationChallenge(input: GenerateRegistrationInput) {
	const options = await generateRegistrationOptions({
		rpName: input.rpName,
		rpID: input.rpId,
		userID: new TextEncoder().encode(input.userId),
		userName: input.userName,
		userDisplayName: input.userDisplayName,
		authenticatorSelection: {
			residentKey: 'required',
			userVerification: 'required',
		},
		excludeCredentials: input.excludeCredentialIds?.map((id) => ({
			id,
			type: 'public-key',
		})),
	});

	return options;
}

/**
 * Verify a WebAuthn registration response.
 * Returns the verified credential data or throws on failure.
 */
export async function verifyRegistration(
	response: RegistrationResponseJSON,
	expectedChallenge: string,
	rpId: string,
	origin: string,
): Promise<VerifiedRegistration> {
	const verification = await verifyRegistrationResponse({
		response,
		expectedChallenge,
		expectedRPID: rpId,
		expectedOrigin: origin,
	});

	if (!verification.verified || !verification.registrationInfo) {
		throw new Error('WebAuthn registration verification failed');
	}

	const { credential } = verification.registrationInfo;

	return {
		credentialId: credential.id,
		publicKey: new Uint8Array(credential.publicKey),
		counter: credential.counter,
	};
}

/**
 * Generate WebAuthn authentication options.
 * Returns PublicKeyCredentialRequestOptionsJSON to send to the client.
 */
export async function generateAuthChallenge(input: GenerateAuthInput) {
	const options = await generateAuthenticationOptions({
		rpID: input.rpId,
		allowCredentials: input.allowCredentialIds?.map((id) => ({
			id,
			type: 'public-key',
		})),
		userVerification: 'required',
	});

	return options;
}

/**
 * Verify a WebAuthn authentication response.
 * Returns the verified credential id and new counter, or throws on failure.
 */
export async function verifyAuthentication(input: VerifyAuthInput): Promise<VerifiedAuth> {
	const verification = await verifyAuthenticationResponse({
		response: input.response,
		expectedChallenge: input.expectedChallenge,
		expectedRPID: input.rpId,
		expectedOrigin: input.origin,
		credential: {
			id: input.credentialId,
			publicKey: new Uint8Array(input.credentialPublicKey) as ReturnType<Uint8Array['slice']>,
			counter: input.credentialCounter,
		},
	});

	if (!verification.verified) {
		throw new Error('WebAuthn authentication verification failed');
	}

	return {
		credentialId: input.credentialId,
		newCounter: verification.authenticationInfo.newCounter,
	};
}
