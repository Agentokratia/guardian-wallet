import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpException, HttpStatus, Inject, Logger, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { IVaultStore } from '@agentokratia/guardian-core';
import type { AuthenticatedRequest } from '../common/authenticated-request.js';
import { ChainRegistryService } from '../common/chain.module.js';
import { NetworkService } from '../networks/network.service.js';
import { hexToBytes } from '../common/encoding.js';
import { EitherAuthGuard } from '../common/either-auth.guard.js';
import { VAULT_STORE } from '../common/vault.module.js';
import { AddTokenDto } from '../tokens/dto/add-token.dto.js';
import { TokenService } from '../tokens/token.service.js';
import { CreateSignerDto } from './dto/create-signer.dto.js';
import { SimulateDto } from './dto/simulate.dto.js';
import { StoreUserShareDto } from './dto/store-user-share.dto.js';
import { UpdateSignerDto } from './dto/update-signer.dto.js';
import { SignerService } from './signer.service.js';
import { signerToPublic } from './signer.types.js';

const BALANCE_CACHE_TTL = 15_000;
interface BalanceResult {
	address: string;
	balances: { network: string; chainId: number; balance: string; rpcError?: boolean }[];
}
const balanceCache = new Map<string, { data: BalanceResult; ts: number }>();

@Controller('signers')
@UseGuards(EitherAuthGuard)
export class SignerController {
	private readonly logger = new Logger(SignerController.name);

	constructor(
		@Inject(SignerService) private readonly signerService: SignerService,
		@Inject(ChainRegistryService) private readonly chainRegistry: ChainRegistryService,
		@Inject(NetworkService) private readonly networkService: NetworkService,
		@Inject(VAULT_STORE) private readonly vault: IVaultStore,
		@Inject(TokenService) private readonly tokenService: TokenService,
	) {}

	/**
	 * Verify that the authenticated user owns the requested signer.
	 * - API key auth: req.signerId must match the requested id.
	 * - Session auth: signer.ownerAddress must match req.sessionUser.
	 */
	private async getOwnedSigner(id: string, req: AuthenticatedRequest) {
		if (req.signerId && req.signerId !== id) {
			throw new ForbiddenException('API key does not match this signer');
		}
		const signer = await this.signerService.get(id);
		if (req.sessionUser && signer.ownerAddress.toLowerCase() !== req.sessionUser.toLowerCase()) {
			throw new ForbiddenException('You do not own this signer');
		}
		return signer;
	}

	@Post()
	async create(@Body() body: CreateSignerDto, @Req() req: AuthenticatedRequest) {
		if (!req.sessionUser) {
			throw new BadRequestException('Signer creation requires wallet authentication');
		}
		const result = await this.signerService.create({
			...body,
			ownerAddress: req.sessionUser,
		});
		return { signer: signerToPublic(result.signer), apiKey: result.apiKey };
	}

	@Get()
	async list(@Req() req: AuthenticatedRequest) {
		if (req.signerId) {
			const signer = await this.signerService.get(req.signerId);
			return [signerToPublic(signer)];
		}
		if (req.sessionUser) {
			const signers = await this.signerService.listByOwner(req.sessionUser);
			return signers.map(signerToPublic);
		}
		return [];
	}

	@Get(':id')
	async get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
		return signerToPublic(await this.getOwnedSigner(id, req));
	}

	@Patch(':id')
	async update(@Param('id') id: string, @Body() body: UpdateSignerDto, @Req() req: AuthenticatedRequest) {
		await this.getOwnedSigner(id, req);
		return signerToPublic(await this.signerService.update(id, body));
	}

	@Delete(':id')
	async revoke(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
		await this.getOwnedSigner(id, req);
		return signerToPublic(await this.signerService.revoke(id));
	}

	@Post(':id/regenerate-key')
	async regenerateApiKey(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
		await this.getOwnedSigner(id, req);
		const result = await this.signerService.regenerateApiKey(id);
		return { signer: signerToPublic(result.signer), apiKey: result.apiKey };
	}

	@Post(':id/pause')
	async pause(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
		await this.getOwnedSigner(id, req);
		return signerToPublic(await this.signerService.pause(id));
	}

	@Post(':id/resume')
	async resume(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
		await this.getOwnedSigner(id, req);
		return signerToPublic(await this.signerService.resume(id));
	}

	@Get(':id/balance')
	async getBalance(
		@Param('id') id: string,
		@Query('network') networkFilter: string | undefined,
		@Query('chainId') chainIdFilter: string | undefined,
		@Req() req: AuthenticatedRequest,
	) {
		const signer = await this.getOwnedSigner(id, req);

		// Cache key — address + filters
		const cacheKey = `${signer.ethAddress}:${networkFilter ?? ''}:${chainIdFilter ?? ''}`;
		const cached = balanceCache.get(cacheKey);
		if (cached && Date.now() - cached.ts < BALANCE_CACHE_TTL) {
			return cached.data;
		}

		let networks;
		if (chainIdFilter) {
			networks = [await this.networkService.getByChainId(Number(chainIdFilter))];
		} else if (networkFilter) {
			networks = [await this.networkService.getByName(networkFilter)];
		} else {
			networks = await this.networkService.listEnabled();
		}

		// Race all networks — return whatever responds within 3s, drop the rest
		const RPC_TIMEOUT = 3_000;
		const timeout = (ms: number) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

		const results = await Promise.allSettled(
			networks.map(async (n) => {
				const chain = await this.chainRegistry.getChain(n.chainId);
				const wei = await Promise.race([
					chain.getBalance(signer.ethAddress),
					timeout(RPC_TIMEOUT),
				]);
				return { network: n.name, chainId: n.chainId, balance: wei.toString() };
			}),
		);

		const balances = results.map((r, i) => {
			if (r.status === 'fulfilled') return r.value;
			const n = networks[i]!;
			const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
			this.logger.warn(`RPC failed for ${n.name} (chainId=${n.chainId}): ${reason}`);
			return { network: n.name, chainId: n.chainId, balance: '0', rpcError: true };
		});

		const response = { address: signer.ethAddress, balances };
		balanceCache.set(cacheKey, { data: response, ts: Date.now() });
		return response;
	}

	@Post(':id/simulate')
	async simulate(@Param('id') id: string, @Body() body: SimulateDto, @Req() req: AuthenticatedRequest) {
		await this.getOwnedSigner(id, req);
		try {
			const chain = await this.chainRegistry.getChainByName(body.network);
			const data = body.data ? hexToBytes(body.data) : undefined;
			const value = body.value ? parseEthToWei(body.value) : undefined;
			const estimatedGas = await chain.estimateGas({
				to: body.to,
				value,
				data,
			});
			const gasPrice = await chain.getGasPrice();
			const gasCostWei = estimatedGas * gasPrice;
			const gasCostEth = Number(gasCostWei) / 1e18;
			return {
				estimatedGas: estimatedGas.toString(),
				gasCostEth: gasCostEth.toFixed(8),
				success: true,
			};
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Simulation failed';
			return {
				estimatedGas: '0',
				gasCostEth: '0',
				success: false,
				error: message,
			};
		}
	}

	@Post(':id/user-share')
	async storeUserShare(@Param('id') id: string, @Body() body: StoreUserShareDto, @Req() req: AuthenticatedRequest) {
		await this.getOwnedSigner(id, req);
		const json = JSON.stringify(body);
		const bytes = new TextEncoder().encode(json);
		await this.vault.storeShare(`user-encrypted/${id}`, bytes);
		return { success: true };
	}

	@Get(':id/user-share')
	async getUserShare(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
		await this.getOwnedSigner(id, req);
		try {
			const bytes = await this.vault.getShare(`user-encrypted/${id}`);
			const json = new TextDecoder().decode(bytes);
			const blob = JSON.parse(json);
			this.logger.log(`getUserShare: sessionUser=${req.sessionUser}, blob.walletAddress=${blob.walletAddress}, iv=${blob.iv?.slice(0, 20)}, salt=${blob.salt?.slice(0, 20)}, ct_len=${blob.ciphertext?.length}`);
			if (
				req.sessionUser &&
				blob.walletAddress &&
				req.sessionUser.toLowerCase() !== blob.walletAddress.toLowerCase()
			) {
				this.logger.warn(`getUserShare: walletAddress MISMATCH — session=${req.sessionUser} vs stored=${blob.walletAddress}`);
				throw new ForbiddenException('Wallet address mismatch');
			}
			return blob;
		} catch (error: unknown) {
			if (error instanceof HttpException) throw error;
			this.logger.error(`getUserShare: Vault read failed for user-encrypted/${id}:`, error);
			throw new HttpException('User share not found', HttpStatus.NOT_FOUND);
		}
	}

	/* ================================================================ */
	/*  Token tracking                                                   */
	/* ================================================================ */

	@Get(':id/tokens')
	async listTokens(
		@Param('id') id: string,
		@Query('chainId') chainIdParam: string | undefined,
		@Req() req: AuthenticatedRequest,
	) {
		const signer = await this.getOwnedSigner(id, req);
		const chainId = chainIdParam ? Number(chainIdParam) : undefined;
		if (!chainId) {
			throw new BadRequestException('chainId query parameter is required');
		}
		return this.tokenService.getTokensForSigner(signer.id, chainId);
	}

	@Get(':id/token-balances')
	async getTokenBalances(
		@Param('id') id: string,
		@Query('chainId') chainIdParam: string | undefined,
		@Req() req: AuthenticatedRequest,
	) {
		const signer = await this.getOwnedSigner(id, req);
		const chainId = chainIdParam ? Number(chainIdParam) : undefined;
		if (!chainId) {
			throw new BadRequestException('chainId query parameter is required');
		}
		return this.tokenService.getTokenBalances(signer.id, signer.ethAddress, chainId);
	}

	@Post(':id/tokens')
	async addToken(
		@Param('id') id: string,
		@Body() body: AddTokenDto,
		@Req() req: AuthenticatedRequest,
	) {
		await this.getOwnedSigner(id, req);
		return this.tokenService.addToken(
			id,
			body.chainId,
			body.symbol,
			body.name,
			body.address,
			body.decimals ?? 18,
		);
	}

	@Delete(':id/tokens/:tokenId')
	async removeToken(
		@Param('id') id: string,
		@Param('tokenId') tokenId: string,
		@Req() req: AuthenticatedRequest,
	) {
		await this.getOwnedSigner(id, req);
		const removed = await this.tokenService.removeToken(tokenId, id);
		if (!removed) {
			throw new NotFoundException('Token not found');
		}
		return { success: true };
	}
}

function parseEthToWei(ethString: string): bigint {
	const parts = ethString.split('.');
	const whole = parts[0] ?? '0';
	const frac = (parts[1] ?? '').padEnd(18, '0').slice(0, 18);
	const weiString = `${whole}${frac}`.replace(/^0+/, '') || '0';
	return BigInt(weiString);
}
