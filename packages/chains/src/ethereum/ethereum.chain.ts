import type {
	DecodedAction,
	FeeEstimate,
	IChain,
	TransactionRequest,
} from '@agentokratia/guardian-core';
import {
	http,
	type PublicClient,
	createPublicClient,
	hexToBytes,
	isAddress,
	parseTransaction,
	serializeTransaction,
	toHex,
} from 'viem';
import { decodeCalldata } from './ethereum.decoder.js';

export class EthereumChain implements IChain {
	readonly chainId: number;
	readonly name: string;
	private readonly client: PublicClient;

	constructor(chainId: number, name: string, rpcUrl: string) {
		this.chainId = chainId;
		this.name = name;
		this.client = createPublicClient({
			transport: http(rpcUrl, { timeout: 3_000 }),
		});
	}

	async buildTransaction(request: TransactionRequest): Promise<Uint8Array> {
		if (request.to != null && !isAddress(request.to)) {
			throw new Error(`Invalid Ethereum address: ${request.to}`);
		}
		const to = request.to as `0x${string}` | undefined;
		const data = request.data ? toHex(request.data) : undefined;

		const serialized = request.maxFeePerGas
			? serializeTransaction({
					type: 'eip1559' as const,
					to,
					value: request.value,
					data,
					chainId: request.chainId,
					gas: request.gasLimit,
					maxFeePerGas: request.maxFeePerGas,
					maxPriorityFeePerGas: request.maxPriorityFeePerGas,
					nonce: request.nonce,
				})
			: serializeTransaction({
					type: 'legacy' as const,
					to,
					value: request.value,
					data,
					chainId: request.chainId,
					gas: request.gasLimit,
					gasPrice: request.gasPrice,
					nonce: request.nonce,
				});

		return hexToBytes(serialized);
	}

	serializeSignedTransaction(
		unsignedTx: Uint8Array,
		signature: { r: Uint8Array; s: Uint8Array; v?: number },
	): Uint8Array {
		const tx = parseTransaction(toHex(unsignedTx));

		const rHex = toHex(signature.r);
		const sHex = toHex(signature.s);

		const v = signature.v ?? 27;
		const yParity = v === 28 ? 1 : 0;

		const to = tx.to as `0x${string}` | undefined;
		const data = tx.data as `0x${string}` | undefined;

		const sig = { r: rHex, s: sHex, v: BigInt(v), yParity } as const;

		const serialized =
			tx.type === 'eip1559'
				? serializeTransaction(
						{
							type: 'eip1559' as const,
							to,
							value: tx.value,
							data,
							chainId: tx.chainId,
							gas: tx.gas,
							maxFeePerGas: tx.maxFeePerGas,
							maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
							nonce: tx.nonce,
						},
						sig,
					)
				: serializeTransaction(
						{
							type: 'legacy' as const,
							to,
							value: tx.value,
							data,
							chainId: tx.chainId,
							gas: tx.gas,
							gasPrice: tx.gasPrice,
							nonce: tx.nonce,
						},
						sig,
					);

		return hexToBytes(serialized);
	}

	decodeTransaction(raw: Uint8Array): DecodedAction {
		const tx = parseTransaction(toHex(raw));

		const dataBytes = tx.data ? hexToBytes(tx.data) : new Uint8Array(0);
		const decoded = dataBytes.length >= 4 ? decodeCalldata(dataBytes) : undefined;

		return {
			to: tx.to ?? '0x0000000000000000000000000000000000000000',
			value: tx.value ?? 0n,
			data: dataBytes,
			functionSelector: decoded?.selector,
			functionName: decoded?.name,
		};
	}

	async broadcastTransaction(signed: Uint8Array): Promise<string> {
		const txHash = await this.client.sendRawTransaction({
			serializedTransaction: toHex(signed),
		});
		return txHash;
	}

	async getBalance(address: string): Promise<bigint> {
		return this.client.getBalance({
			address: address as `0x${string}`,
		});
	}

	async getNonce(address: string): Promise<number> {
		return this.client.getTransactionCount({
			address: address as `0x${string}`,
		});
	}

	async estimateGas(request: {
		from?: string;
		to?: string;
		value?: bigint;
		data?: Uint8Array;
	}): Promise<bigint> {
		const data = request.data ? toHex(request.data) : undefined;
		return this.client.estimateGas({
			account: request.from as `0x${string}` | undefined,
			to: request.to as `0x${string}` | undefined,
			value: request.value,
			data,
		});
	}

	async getGasPrice(): Promise<bigint> {
		return this.client.getGasPrice();
	}

	async estimateFeesPerGas(): Promise<FeeEstimate> {
		const fees = await this.client.estimateFeesPerGas();
		return {
			maxFeePerGas: fees.maxFeePerGas,
			maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
		};
	}

	async getTokenBalance(tokenAddress: string, ownerAddress: string): Promise<bigint> {
		const result = await this.client.call({
			to: tokenAddress as `0x${string}`,
			data: `0x70a08231000000000000000000000000${ownerAddress.slice(2).toLowerCase()}` as `0x${string}`,
		});
		if (!result.data || result.data === '0x') return 0n;
		return BigInt(result.data);
	}
}
