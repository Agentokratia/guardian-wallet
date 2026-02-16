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
		const requests = (guard as unknown as { requests: Map<string, { count: number; windowStart: number }> }).requests;
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
