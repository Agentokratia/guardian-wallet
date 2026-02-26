import { HttpException, HttpStatus } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitGuard } from '../rate-limit.guard.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(ip: string): ExecutionContext {
	return {
		switchToHttp: () => ({
			getRequest: () => ({
				ip,
				socket: { remoteAddress: ip },
			}),
		}),
	} as unknown as ExecutionContext;
}

function makeEmailContext(ip: string, email: string, path: string): ExecutionContext {
	return {
		switchToHttp: () => ({
			getRequest: () => ({
				ip,
				socket: { remoteAddress: ip },
				body: { email },
				path,
			}),
		}),
	} as unknown as ExecutionContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RateLimitGuard', () => {
	let guard: RateLimitGuard;

	beforeEach(() => {
		guard = new RateLimitGuard();
	});

	it('allows first request from an IP', () => {
		const result = guard.canActivate(makeContext('192.168.1.1'));
		expect(result).toBe(true);
	});

	it('allows up to 100 requests from the same IP', () => {
		const ctx = makeContext('192.168.1.2');
		for (let i = 0; i < 100; i++) {
			expect(guard.canActivate(ctx)).toBe(true);
		}
	});

	it('throws 429 on the 101st request from the same IP', () => {
		const ctx = makeContext('192.168.1.3');
		for (let i = 0; i < 100; i++) {
			guard.canActivate(ctx);
		}

		try {
			guard.canActivate(ctx);
			expect.fail('Should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(HttpException);
			expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
		}
	});

	it('tracks different IPs independently', () => {
		const ctx1 = makeContext('10.0.0.1');
		const ctx2 = makeContext('10.0.0.2');

		// Exhaust IP 1
		for (let i = 0; i < 100; i++) {
			guard.canActivate(ctx1);
		}

		// IP 2 should still be allowed
		expect(guard.canActivate(ctx2)).toBe(true);
	});

	it('resets window after timeout expires', () => {
		const ctx = makeContext('10.0.0.3');

		// Exhaust the limit
		for (let i = 0; i < 100; i++) {
			guard.canActivate(ctx);
		}

		// Simulate time passing beyond the 60s window
		// Access internal state to force window expiry
		const requests = (
			guard as unknown as { requests: Map<string, { count: number; windowStart: number }> }
		).requests;
		const entry = requests.get('10.0.0.3');
		if (entry) {
			entry.windowStart = Date.now() - 61_000; // 61 seconds ago
		}

		// Should be allowed again (new window)
		expect(guard.canActivate(ctx)).toBe(true);
	});

	it('falls back to socket.remoteAddress when ip is undefined', () => {
		const ctx = {
			switchToHttp: () => ({
				getRequest: () => ({
					ip: undefined,
					socket: { remoteAddress: '172.16.0.1' },
				}),
			}),
		} as unknown as ExecutionContext;

		expect(guard.canActivate(ctx)).toBe(true);
	});

	it('uses "unknown" key when both ip and remoteAddress are undefined', () => {
		const ctx = {
			switchToHttp: () => ({
				getRequest: () => ({
					ip: undefined,
					socket: { remoteAddress: undefined },
				}),
			}),
		} as unknown as ExecutionContext;

		expect(guard.canActivate(ctx)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Email-scoped OTP rate limits
// ---------------------------------------------------------------------------

describe('RateLimitGuard — email-scoped OTP limits', () => {
	let guard: RateLimitGuard;

	beforeEach(() => {
		guard = new RateLimitGuard();
	});

	// Access internal emailLimits map for time manipulation
	function getEmailLimits(g: RateLimitGuard) {
		return (
			g as unknown as {
				emailLimits: Map<
					string,
					{
						sendCount: number;
						sendWindowStart: number;
						challengeCount: number;
						challengeWindowStart: number;
						verifyFailures: number;
						lockedUntil: number;
					}
				>;
			}
		).emailLimits;
	}

	it('allows first 5 OTP sends per email per hour on /login', () => {
		const ctx = makeEmailContext('10.0.0.1', 'user@example.com', '/auth/login');
		for (let i = 0; i < 5; i++) {
			expect(guard.canActivate(ctx)).toBe(true);
		}
	});

	it('throws 429 on 6th OTP send for the same email', () => {
		const ctx = makeEmailContext('10.0.0.1', 'user@example.com', '/auth/login');
		for (let i = 0; i < 5; i++) {
			guard.canActivate(ctx);
		}

		try {
			guard.canActivate(ctx);
			expect.fail('Should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(HttpException);
			expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
			expect((error as HttpException).message).toBe(
				'Too many verification codes requested. Try again later.',
			);
		}
	});

	it('tracks different emails independently', () => {
		const ctx1 = makeEmailContext('10.0.0.1', 'email1@example.com', '/auth/login');
		const ctx2 = makeEmailContext('10.0.0.1', 'email2@example.com', '/auth/login');

		// Exhaust email1
		for (let i = 0; i < 5; i++) {
			guard.canActivate(ctx1);
		}

		// email2 should still be allowed
		expect(guard.canActivate(ctx2)).toBe(true);
	});

	it('resets send window after 1 hour', () => {
		const ctx = makeEmailContext('10.0.0.1', 'user@example.com', '/auth/login');

		// Exhaust the 5-send limit
		for (let i = 0; i < 5; i++) {
			guard.canActivate(ctx);
		}

		// Simulate 1 hour passing by moving sendWindowStart back
		const emailLimits = getEmailLimits(guard);
		const entry = emailLimits.get('user@example.com');
		if (entry) {
			entry.sendWindowStart = Date.now() - 3_600_001; // just over 1 hour ago
		}

		// Should be allowed again (new window)
		expect(guard.canActivate(ctx)).toBe(true);
	});

	it('locks out email after 10 verify failures', () => {
		const email = 'brute@example.com';

		for (let i = 0; i < 10; i++) {
			guard.recordVerifyFailure(email);
		}

		expect(guard.isLockedOut(email)).toBe(true);

		// canActivate should also throw for locked email
		const ctx = makeEmailContext('10.0.0.1', email, '/auth/login');
		try {
			guard.canActivate(ctx);
			expect.fail('Should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(HttpException);
			expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
			expect((error as HttpException).message).toContain('Account temporarily locked');
		}
	});

	it('includes remaining minutes in lockout error message', () => {
		const email = 'locked@example.com';

		for (let i = 0; i < 10; i++) {
			guard.recordVerifyFailure(email);
		}

		const ctx = makeEmailContext('10.0.0.1', email, '/auth/login');
		try {
			guard.canActivate(ctx);
			expect.fail('Should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(HttpException);
			const message = (error as HttpException).message;
			expect(message).toMatch(/Try again in \d+ minutes/);
		}
	});

	it('recordVerifySuccess resets failure count', () => {
		const email = 'user@example.com';

		// Accumulate 9 failures (one below lockout threshold)
		for (let i = 0; i < 9; i++) {
			guard.recordVerifyFailure(email);
		}

		// Successful verification resets
		guard.recordVerifySuccess(email);

		// One more failure should NOT lock (count was reset to 0, now becomes 1)
		guard.recordVerifyFailure(email);
		expect(guard.isLockedOut(email)).toBe(false);
	});

	it('lockout expires after 15 minutes', () => {
		const email = 'expired@example.com';

		// Trigger lockout
		for (let i = 0; i < 10; i++) {
			guard.recordVerifyFailure(email);
		}
		expect(guard.isLockedOut(email)).toBe(true);

		// Simulate 15 minutes passing by setting lockedUntil to the past
		const emailLimits = getEmailLimits(guard);
		const entry = emailLimits.get(email);
		if (entry) {
			entry.lockedUntil = Date.now() - 1; // already expired
		}

		expect(guard.isLockedOut(email)).toBe(false);
	});

	it('normalizes email case — Test@Example.com and test@example.com share limits', () => {
		const ctxUpper = makeEmailContext('10.0.0.1', 'Test@Example.com', '/auth/login');
		const ctxLower = makeEmailContext('10.0.0.1', 'test@example.com', '/auth/login');

		// 3 sends with mixed-case
		for (let i = 0; i < 3; i++) {
			guard.canActivate(ctxUpper);
		}

		// 2 more with lowercase (should reach the 5 limit)
		guard.canActivate(ctxLower);
		guard.canActivate(ctxLower);

		// 6th send (either case) should be blocked
		try {
			guard.canActivate(ctxUpper);
			expect.fail('Should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(HttpException);
			expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
		}
	});

	it('non-login paths do not count toward OTP send limit', () => {
		const loginCtx = makeEmailContext('10.0.0.1', 'user@example.com', '/auth/login');
		const verifyCtx = makeEmailContext('10.0.0.1', 'user@example.com', '/auth/verify-otp');

		// Hit verify-otp many times — should not affect send count
		for (let i = 0; i < 10; i++) {
			guard.canActivate(verifyCtx);
		}

		// All 5 login sends should still be available
		for (let i = 0; i < 5; i++) {
			expect(guard.canActivate(loginCtx)).toBe(true);
		}
	});

	it('passkey challenge and OTP send have independent limits', () => {
		const loginCtx = makeEmailContext('10.0.0.1', 'user@example.com', '/auth/login');
		const challengeCtx = makeEmailContext(
			'10.0.0.1',
			'user@example.com',
			'/api/v1/auth/passkey/login-challenge',
		);

		// Exhaust OTP send limit (5)
		for (let i = 0; i < 5; i++) {
			guard.canActivate(loginCtx);
		}

		// OTP should be blocked
		try {
			guard.canActivate(loginCtx);
			expect.fail('Should have thrown');
		} catch (error) {
			expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
		}

		// Passkey challenges should still be allowed (separate counter)
		for (let i = 0; i < 10; i++) {
			expect(guard.canActivate(challengeCtx)).toBe(true);
		}
	});

	it('throws 429 on 11th passkey challenge for the same email', () => {
		const ctx = makeEmailContext(
			'10.0.0.1',
			'user@example.com',
			'/api/v1/auth/passkey/login-challenge',
		);
		for (let i = 0; i < 10; i++) {
			guard.canActivate(ctx);
		}

		try {
			guard.canActivate(ctx);
			expect.fail('Should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(HttpException);
			expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
			expect((error as HttpException).message).toBe('Too many login attempts. Try again later.');
		}
	});
});
