import { isIP } from 'node:net';
import type { IpAddressCriterion, PolicyContext } from '@agentokratia/guardian-core';
import type { CriterionEvaluator } from './types.js';

// ─── IP Helpers (only used by this evaluator) ────────────────────────────────

function ipv4ToNum(ip: string): number | null {
	const parts = ip.split('.');
	if (parts.length !== 4) return null;
	let num = 0;
	for (const part of parts) {
		const n = Number.parseInt(part, 10);
		if (Number.isNaN(n) || n < 0 || n > 255) return null;
		num = (num << 8) | n;
	}
	return num >>> 0;
}

function ipInCidr(ip: string, cidr: string): boolean {
	const [range, prefixStr] = cidr.split('/');
	if (!range || !prefixStr) return false;
	const prefix = Number.parseInt(prefixStr, 10);
	if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) return false;

	if (isIP(ip) !== 4 || isIP(range) !== 4) return false;

	const ipNum = ipv4ToNum(ip);
	const rangeNum = ipv4ToNum(range);
	if (ipNum === null || rangeNum === null) return false;
	const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
	return (ipNum & mask) === (rangeNum & mask);
}

function ipMatches(ip: string, pattern: string): boolean {
	if (pattern.includes('/')) {
		return ipInCidr(ip, pattern);
	}
	return ip === pattern;
}

// ─── Evaluator ───────────────────────────────────────────────────────────────

export const ipAddressEvaluator: CriterionEvaluator<IpAddressCriterion> = {
	type: 'ipAddress',
	evaluate(c, ctx) {
		// Empty allowlist → no IP restriction configured → pass
		if (c.operator === 'in' && c.ips.length === 0) return true;

		const ip = ctx.callerIp;
		if (!ip) return false;

		const found = c.ips.some((pattern) => ipMatches(ip, pattern));
		return c.operator === 'in' ? found : !found;
	},
	failReason(_c, ctx) {
		return {
			short: 'IP not allowed',
			detail: `IP ${ctx.callerIp ?? 'unknown'} is not allowed`,
		};
	},
};
