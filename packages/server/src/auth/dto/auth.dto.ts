import {
	IsEmail,
	IsNotEmpty,
	IsNumber,
	IsObject,
	IsOptional,
	IsString,
	IsUUID,
	Matches,
	Max,
	MaxLength,
	Min,
} from 'class-validator';

/**
 * POST /auth/register — Start registration: send OTP to email.
 */
export class RegisterDto {
	@IsEmail()
	@IsNotEmpty()
	email!: string;
}

/**
 * POST /auth/verify-email — Verify email OTP, return passkey registration options.
 */
export class VerifyEmailDto {
	@IsEmail()
	@IsNotEmpty()
	email!: string;

	@IsString()
	@IsNotEmpty()
	@MaxLength(10)
	code!: string;
}

/**
 * POST /auth/passkey/register — Complete passkey registration, set session cookie.
 */
export class PasskeyRegisterDto {
	@IsUUID()
	@IsNotEmpty()
	userId!: string;

	@IsObject()
	@IsNotEmpty()
	response!: Record<string, unknown>;

	@IsOptional()
	@IsString()
	@Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'prfDerivedAddress must be a valid Ethereum address' })
	prfDerivedAddress?: string;
}

/**
 * POST /auth/passkey/login-challenge — Get authentication challenge for login.
 */
export class LoginChallengeDto {
	@IsEmail()
	@IsNotEmpty()
	email!: string;
}

/**
 * POST /auth/passkey/login — Verify passkey login, set session cookie.
 */
export class PasskeyLoginDto {
	@IsEmail()
	@IsNotEmpty()
	email!: string;

	@IsObject()
	@IsNotEmpty()
	response!: Record<string, unknown>;
}

/**
 * POST /auth/admin-token — Exchange X-Admin-Token for a short-lived admin JWT.
 */
export class AdminTokenDto {
	@IsUUID()
	@IsNotEmpty()
	signerId!: string;

	@IsString()
	@IsNotEmpty()
	adminToken!: string;

	@IsOptional()
	@IsNumber()
	@Min(60)
	@Max(3600)
	ttl?: number;
}
