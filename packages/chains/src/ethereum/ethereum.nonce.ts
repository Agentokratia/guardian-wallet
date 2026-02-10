export class EthereumNonceManager {
	private readonly nonces = new Map<string, number>();
	private readonly reserved = new Map<string, Set<number>>();
	private readonly getNonceFn: (address: string) => Promise<number>;
	private lockPromise: Promise<void> = Promise.resolve();

	constructor(getNonceFn: (address: string) => Promise<number>) {
		this.getNonceFn = getNonceFn;
	}

	async getNext(address: string): Promise<number> {
		let release: () => void = () => {};
		const acquire = new Promise<void>((resolve) => {
			release = resolve;
		});
		const previous = this.lockPromise;
		this.lockPromise = acquire;
		await previous;

		try {
			const key = address.toLowerCase();

			let current = this.nonces.get(key);

			if (current === undefined) {
				current = await this.getNonceFn(address);
				this.nonces.set(key, current);
			}

			// Skip any already-reserved nonces (in-flight transactions)
			const addressReserved = this.reserved.get(key);
			while (addressReserved?.has(current)) {
				current++;
			}

			// Reserve and advance
			this.nonces.set(key, current + 1);
			await this.reserve(address, current);

			return current;
		} finally {
			release();
		}
	}

	async reserve(address: string, nonce: number): Promise<void> {
		const key = address.toLowerCase();
		let set = this.reserved.get(key);
		if (!set) {
			set = new Set();
			this.reserved.set(key, set);
		}
		set.add(nonce);
	}

	async release(address: string, nonce: number): Promise<void> {
		const key = address.toLowerCase();
		const reservedSet = this.reserved.get(key);
		if (reservedSet) {
			reservedSet.delete(nonce);
		}

		// Clear the cached counter so next getNext() re-fetches from chain.
		// The chain is the source of truth for which nonces have been mined.
		// The reserved set still prevents re-issuing in-flight nonces.
		this.nonces.delete(key);
	}
}
