import {
	IsBoolean,
	IsEmail,
	IsNotEmpty,
	IsObject,
	IsOptional,
	IsString,
	Matches,
} from 'class-validator';

/**
 * POST /auth/login — Check user + conditionally send OTP.
 * If user has a passkey and sendOtp is not true: no OTP sent.
 * Pass sendOtp: true to force OTP (e.g. "Use email code instead" fallback).
 */
export class LoginDto {
	@IsEmail()
	@IsNotEmpty()
	email!: string;

	@IsOptional()
	@IsBoolean()
	sendOtp?: boolean;
}

/**
 * POST /auth/verify-otp — Verify OTP, issue JWT session token.
 */
export class VerifyOTPDto {
	@IsEmail()
	@IsNotEmpty()
	email!: string;

	@IsString()
	@IsNotEmpty()
	@Matches(/^\d{6}$/, { message: 'Code must be exactly 6 digits' })
	code!: string;
}

/**
 * POST /auth/passkey/login-challenge — Get passkey authentication challenge (unauthenticated).
 */
export class PasskeyLoginChallengeDto {
	@IsEmail()
	@IsNotEmpty()
	email!: string;
}

/**
 * POST /auth/passkey/login-verify — Verify passkey authentication (unauthenticated).
 */
export class PasskeyLoginVerifyDto {
	@IsEmail()
	@IsNotEmpty()
	email!: string;

	@IsObject()
	@IsNotEmpty()
	response!: Record<string, unknown>;
}

/**
 * POST /auth/refresh — Rotate refresh token, issue new access + refresh tokens.
 * CLI sends refreshToken in body; dashboard uses HttpOnly cookie.
 */
export class RefreshDto {
	@IsOptional()
	@IsString()
	refreshToken?: string;
}

/**
 * POST /auth/passkey/setup-complete — Complete optional passkey registration (for signing).
 */
export class PasskeySetupCompleteDto {
	@IsObject()
	@IsNotEmpty()
	response!: Record<string, unknown>;

	@IsOptional()
	@IsString()
	@Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'prfDerivedAddress must be a valid Ethereum address' })
	prfDerivedAddress?: string;
}
