import type { Share } from '@agentokratia/guardian-core';

// ---------------------------------------------------------------------------
// Wipe
// ---------------------------------------------------------------------------

/**
 * Zero-fill the share data in memory. Call this in a `finally` block after
 * every signing operation to uphold the core invariant.
 */
export function wipeShare(share: Share): void {
	(share.data as Uint8Array).fill(0);
	(share.publicKey as Uint8Array).fill(0);
}
