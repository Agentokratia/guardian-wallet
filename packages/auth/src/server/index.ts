export { ChallengeStore } from './challenge-store.js';
export type { ChallengeStoreOptions } from './challenge-store.js';

export { generateOTP, validateOTP } from './otp.js';

export {
	generateAuthChallenge,
	generateRegistrationChallenge,
	verifyAuthentication,
	verifyRegistration,
} from './webauthn-server.js';
export type {
	GenerateAuthInput,
	GenerateRegistrationInput,
	VerifiedAuth,
	VerifiedRegistration,
	VerifyAuthInput,
} from './webauthn-server.js';
