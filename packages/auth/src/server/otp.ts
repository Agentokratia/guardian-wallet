import { randomInt, timingSafeEqual } from 'node:crypto';
import type { OTPData } from '../shared/types.js';

const DEFAULT_OTP_LENGTH = 6;
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Generate a cryptographically random OTP code.
 * Each digit is independently sampled via crypto.randomInt.
 */
export function generateOTP(length: number = DEFAULT_OTP_LENGTH): OTPData {
	let code = '';
	for (let i = 0; i < length; i++) {
		code += randomInt(10).toString();
	}

	return {
		code,
		expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
	};
}

/**
 * Validate a provided OTP against stored data.
 * Uses timing-safe comparison to prevent side-channel attacks.
 * Returns false if expired or mismatched.
 */
export function validateOTP(stored: OTPData, provided: string): boolean {
	if (new Date() > stored.expiresAt) {
		return false;
	}

	if (stored.code.length !== provided.length) {
		return false;
	}

	const storedBuf = Buffer.from(stored.code, 'utf-8');
	const providedBuf = Buffer.from(provided, 'utf-8');

	return timingSafeEqual(storedBuf, providedBuf);
}
