import {
	type CanActivate,
	type ExecutionContext,
	HttpException,
	HttpStatus,
	Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

// IP-based limits (existing)
const MAX_REQUESTS = 100;
const WINDOW_MS = 60_000; // 1 minute
const CLEANUP_INTERVAL_MS = 60_000;

// Email-scoped OTP limits (PRD-67)
const OTP_SEND_MAX = 5; // per email per hour
const OTP_SEND_WINDOW_MS = 3_600_000; // 1 hour
// Passkey challenge limit (separate from OTP sends)
const PASSKEY_CHALLENGE_MAX = 10; // per email per hour
const PASSKEY_CHALLENGE_WINDOW_MS = 3_600_000; // 1 hour
// Brute-force protection: 10 total failures → 15min lockout.
// With 6-digit OTP, 10 attempts = 0.001% success probability.
const LOCKOUT_THRESHOLD = 10;
const LOCKOUT_DURATION_MS = 15 * 60_000; // 15 minutes

interface RateLimitEntry {
	count: number;
	windowStart: number;
}

interface EmailRateLimitEntry {
	sendCount: number;
	sendWindowStart: number;
	challengeCount: number;
	challengeWindowStart: number;
	verifyFailures: number;
	lockedUntil: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
	private readonly requests = new Map<string, RateLimitEntry>();
	private readonly emailLimits = new Map<string, EmailRateLimitEntry>();
	private lastCleanup = 0;

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<Request>();
		const ip = request.ip ?? request.socket.remoteAddress ?? 'unknown';
		const now = Date.now();

		if (now - this.lastCleanup > CLEANUP_INTERVAL_MS) {
			this.cleanup(now);
			this.lastCleanup = now;
		}

		// IP-based rate limit (applies to all auth endpoints)
		const entry = this.requests.get(ip);
		if (!entry || now - entry.windowStart > WINDOW_MS) {
			this.requests.set(ip, { count: 1, windowStart: now });
		} else {
			entry.count++;
			if (entry.count > MAX_REQUESTS) {
				throw new HttpException(
					'Too many requests. Try again later.',
					HttpStatus.TOO_MANY_REQUESTS,
				);
			}
		}

		// Email-scoped rate limits for OTP endpoints
		const path = request.path;
		const body = request.body as Record<string, unknown> | undefined;
		const email = (body?.email as string)?.toLowerCase()?.trim();

		if (email) {
			const emailEntry = this.getOrCreateEmailEntry(email, now);

			// Check lockout
			if (emailEntry.lockedUntil > now) {
				const remainingMin = Math.ceil((emailEntry.lockedUntil - now) / 60_000);
				throw new HttpException(
					`Account temporarily locked. Try again in ${remainingMin} minutes.`,
					HttpStatus.TOO_MANY_REQUESTS,
				);
			}

			if (path.endsWith('/login')) {
				// OTP send limit: 5 per email per hour
				if (now - emailEntry.sendWindowStart > OTP_SEND_WINDOW_MS) {
					emailEntry.sendCount = 0;
					emailEntry.sendWindowStart = now;
				}
				emailEntry.sendCount++;
				if (emailEntry.sendCount > OTP_SEND_MAX) {
					throw new HttpException(
						'Too many verification codes requested. Try again later.',
						HttpStatus.TOO_MANY_REQUESTS,
					);
				}
			}

			if (path.endsWith('/passkey/login-challenge')) {
				// Passkey challenge limit: 10 per email per hour (separate from OTP)
				if (now - emailEntry.challengeWindowStart > PASSKEY_CHALLENGE_WINDOW_MS) {
					emailEntry.challengeCount = 0;
					emailEntry.challengeWindowStart = now;
				}
				emailEntry.challengeCount++;
				if (emailEntry.challengeCount > PASSKEY_CHALLENGE_MAX) {
					throw new HttpException(
						'Too many login attempts. Try again later.',
						HttpStatus.TOO_MANY_REQUESTS,
					);
				}
			}

			// verify-otp failures are tracked in the service layer via recordVerifyFailure
		}

		return true;
	}

	/**
	 * Record a verify failure for an email. Called by the auth controller on OTP verification failure.
	 */
	recordVerifyFailure(email: string): void {
		const now = Date.now();
		const entry = this.getOrCreateEmailEntry(email.toLowerCase().trim(), now);
		entry.verifyFailures++;
		if (entry.verifyFailures >= LOCKOUT_THRESHOLD) {
			entry.lockedUntil = now + LOCKOUT_DURATION_MS;
		}
	}

	/**
	 * Reset verify failures on successful OTP verification.
	 * Prevents legitimate users from accumulating toward lockout over time.
	 */
	recordVerifySuccess(email: string): void {
		const entry = this.emailLimits.get(email.toLowerCase().trim());
		if (entry) {
			entry.verifyFailures = 0;
			entry.lockedUntil = 0;
		}
	}

	/**
	 * Check if an email is currently locked out.
	 */
	isLockedOut(email: string): boolean {
		const entry = this.emailLimits.get(email.toLowerCase().trim());
		if (!entry) return false;
		return entry.lockedUntil > Date.now();
	}

	private getOrCreateEmailEntry(email: string, now: number): EmailRateLimitEntry {
		let entry = this.emailLimits.get(email);
		if (!entry) {
			entry = {
				sendCount: 0,
				sendWindowStart: now,
				challengeCount: 0,
				challengeWindowStart: now,
				verifyFailures: 0,
				lockedUntil: 0,
			};
			this.emailLimits.set(email, entry);
		}
		return entry;
	}

	private cleanup(now: number): void {
		for (const [ip, entry] of this.requests) {
			if (now - entry.windowStart > WINDOW_MS) {
				this.requests.delete(ip);
			}
		}
		// Clean up email entries older than 1 hour and not locked
		for (const [email, entry] of this.emailLimits) {
			if (now - entry.sendWindowStart > OTP_SEND_WINDOW_MS && entry.lockedUntil < now) {
				this.emailLimits.delete(email);
			}
		}
	}
}
