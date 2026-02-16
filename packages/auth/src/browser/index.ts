export {
	deriveEOAFromPRF,
	deriveEncryptionKeyFromPRF,
	wipeKey,
	wipePRF,
} from './prf-wallet.js';

export {
	authenticateWithPRF,
	isPRFSupported,
	registerPasskeyWithPRF,
} from './webauthn-client.js';
