export interface TransactionRequest {
	readonly to?: string;
	readonly value?: bigint;
	readonly data?: Uint8Array;
	readonly chainId: number;
	readonly gasLimit?: bigint;
	readonly gasPrice?: bigint;
	readonly maxFeePerGas?: bigint;
	readonly maxPriorityFeePerGas?: bigint;
	readonly nonce?: number;
}

export interface DecodedAction {
	readonly to: string;
	readonly value: bigint;
	readonly data: Uint8Array;
	readonly functionSelector?: string;
	readonly functionName?: string;
	readonly args?: readonly unknown[];
}

export interface FeeEstimate {
	readonly maxFeePerGas: bigint;
	readonly maxPriorityFeePerGas: bigint;
}

export interface IChain {
	readonly chainId: number;
	readonly name: string;

	buildTransaction(request: TransactionRequest): Promise<Uint8Array>;
	decodeTransaction(raw: Uint8Array): DecodedAction;
	serializeSignedTransaction(
		unsignedTx: Uint8Array,
		signature: { r: Uint8Array; s: Uint8Array; v?: number },
	): Uint8Array;
	broadcastTransaction(signed: Uint8Array): Promise<string>;
	getBalance(address: string): Promise<bigint>;
	getNonce(address: string): Promise<number>;
	estimateGas(request: { from?: string; to?: string; value?: bigint; data?: Uint8Array }): Promise<bigint>;
	getGasPrice(): Promise<bigint>;
	estimateFeesPerGas(): Promise<FeeEstimate>;
}
