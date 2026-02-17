import {
	type CanActivate,
	type ExecutionContext,
	HttpException,
	HttpStatus,
	Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

const MAX_REQUESTS = 100;
const WINDOW_MS = 60_000; // 1 minute
const CLEANUP_INTERVAL_MS = 60_000;

interface RateLimitEntry {
	count: number;
	windowStart: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
	private readonly requests = new Map<string, RateLimitEntry>();
	private lastCleanup = 0;

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<Request>();
		const ip = request.ip ?? request.socket.remoteAddress ?? 'unknown';
		const now = Date.now();

		if (now - this.lastCleanup > CLEANUP_INTERVAL_MS) {
			this.cleanup(now);
			this.lastCleanup = now;
		}

		const entry = this.requests.get(ip);
		if (!entry || now - entry.windowStart > WINDOW_MS) {
			this.requests.set(ip, { count: 1, windowStart: now });
			return true;
		}

		entry.count++;
		if (entry.count > MAX_REQUESTS) {
			throw new HttpException('Too many requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
		}

		return true;
	}

	private cleanup(now: number): void {
		for (const [ip, entry] of this.requests) {
			if (now - entry.windowStart > WINDOW_MS) {
				this.requests.delete(ip);
			}
		}
	}
}
