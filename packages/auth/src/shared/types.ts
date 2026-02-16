export interface PRFWalletResult {
	/** 0x-prefixed EIP-55 checksummed Ethereum address */
	address: string;
	/** 32-byte secp256k1 private key — WIPE AFTER USE */
	privateKey: Uint8Array;
}

export interface WebAuthnRegistrationOptions {
	rpId: string;
	rpName: string;
	userId: string;
	userName: string;
	userDisplayName: string;
	/** base64url-encoded challenge */
	challenge: string;
	excludeCredentialIds?: string[];
}

export interface WebAuthnRegistrationResult {
	credentialId: string;
	/** base64-encoded COSE public key */
	publicKeyCose: string;
	counter: number;
	prfOutput?: Uint8Array;
	deviceType: string;
	/** Raw RegistrationResponseJSON from @simplewebauthn/browser — forward to server for verification */
	registrationResponseJSON: unknown;
}

export interface WebAuthnAuthOptions {
	rpId: string;
	/** base64url-encoded challenge */
	challenge: string;
	allowCredentialIds: string[];
}

export interface WebAuthnAuthResult {
	credentialId: string;
	counter: number;
	prfOutput?: Uint8Array;
	/** Raw AuthenticationResponseJSON from @simplewebauthn/browser — forward to server for verification */
	authenticationResponseJSON: unknown;
}

export interface OTPData {
	code: string;
	expiresAt: Date;
}

export interface ChallengeData {
	challenge: string;
	userId: string;
	createdAt: number;
}
