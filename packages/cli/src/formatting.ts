// ---------------------------------------------------------------------------
// Shared formatting utilities for the CLI.
// ---------------------------------------------------------------------------

/**
 * Convert a wei string to a human-readable ETH string with 4 decimal places.
 * Uses BigInt arithmetic to avoid floating-point precision loss.
 */
export function formatWeiToEth(weiStr: string | undefined): string {
	if (!weiStr) return '0.0000';
	try {
		const wei = BigInt(weiStr);
		const whole = wei / 1_000_000_000_000_000_000n;
		const frac = wei % 1_000_000_000_000_000_000n;
		const fracStr = frac.toString().padStart(18, '0').slice(0, 4);
		return `${whole}.${fracStr}`;
	} catch {
		return '0.0000';
	}
}
