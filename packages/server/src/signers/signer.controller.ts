import { type IShareStore, SchemeName, SignerType } from '@agentokratia/guardian-core';
import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	ForbiddenException,
	Get,
	HttpException,
	HttpStatus,
	Inject,
	Logger,
	NotFoundException,
	Param,
	Patch,
	Post,
	Query,
	Req,
	UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/authenticated-request.js';
import { ChainRegistryService } from '../common/chain.module.js';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { EitherAdminGuard } from '../common/either-admin.guard.js';
import { EitherAuthGuard } from '../common/either-auth.guard.js';
import { hexToBytes } from '../common/encoding.js';
import { SessionGuard } from '../common/session.guard.js';
import { SHARE_STORE } from '../common/share-store.module.js';
import { DKGService } from '../dkg/dkg.service.js';
import type { Network } from '../networks/network.repository.js';
import { NetworkService } from '../networks/network.service.js';
import type { AddTokenDto } from '../tokens/dto/add-token.dto.js';
import { TokenService } from '../tokens/token.service.js';
import type { CreatePublicSignerDto } from './dto/create-public-signer.dto.js';
import type { CreateSignerDto } from './dto/create-signer.dto.js';
import type { SimulateDto } from './dto/simulate.dto.js';
import type { StoreUserShareDto } from './dto/store-user-share.dto.js';
import type { UpdateSignerDto } from './dto/update-signer.dto.js';
import { SignerService } from './signer.service.js';
import { signerToPublic } from './signer.types.js';

const PUBLIC_CREATE_WINDOW_MS = 3_600_000; // 1 hour
const BALANCE_CACHE_TTL = 15_000;
interface BalanceResult {
	address: string;
	balances: { network: string; chainId: number; balance: string; rpcError?: boolean }[];
}
const balanceCache = new Map<string, { data: BalanceResult; ts: number }>();

@Controller('signers')
export class SignerController {
	private readonly logger = new Logger(SignerController.name);

	// Rate limit: N public creations per IP per hour
	private readonly publicCreateLimits = new Map<string, { count: number; resetAt: number }>();
	private publicCreateLastCleanup = 0;

	constructor(
		@Inject(SignerService) private readonly signerService: SignerService,
		@Inject(ChainRegistryService) private readonly chainRegistry: ChainRegistryService,
		@Inject(NetworkService) private readonly networkService: NetworkService,
		@Inject(SHARE_STORE) private readonly shareStore: IShareStore,
		@Inject(TokenService) private readonly tokenService: TokenService,
		@Inject(DKGService) private readonly dkgService: DKGService,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
	) {}

	/**
	 * Verify that the authenticated user owns the requested signer.
	 * - API key auth: req.signerId must match the requested id.
	 * - Session auth: signer.ownerAddress must match req.sessionUser.
	 */
	private async getOwnedSigner(id: string, req: AuthenticatedRequest) {
		if (!req.signerId && !req.sessionUser) {
			throw new ForbiddenException('No authenticated identity');
		}
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
	@UseGuards(SessionGuard)
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

	/**
	 * Public signer creation — no auth required.
	 * Creates signer + runs DKG atomically. Returns all credentials.
	 * Rate-limited to 3 per IP per hour. Optional bootstrap token.
	 */
	@Post('public')
	async createPublic(@Body() body: CreatePublicSignerDto, @Req() req: AuthenticatedRequest) {
		// Rate limit per IP per hour (with periodic cleanup)
		const maxPerHour = this.config.PUBLIC_CREATE_LIMIT;
		const ip = req.ip ?? 'unknown';
		const now = Date.now();
		if (now - this.publicCreateLastCleanup > PUBLIC_CREATE_WINDOW_MS) {
			for (const [key, entry] of this.publicCreateLimits) {
				if (now >= entry.resetAt) this.publicCreateLimits.delete(key);
			}
			this.publicCreateLastCleanup = now;
		}
		const limit = this.publicCreateLimits.get(ip);
		if (limit && now < limit.resetAt) {
			if (limit.count >= maxPerHour) {
				throw new HttpException(
					`Rate limit exceeded (${maxPerHour} signers/hour)`,
					HttpStatus.TOO_MANY_REQUESTS,
				);
			}
			limit.count++;
		} else {
			this.publicCreateLimits.set(ip, { count: 1, resetAt: now + PUBLIC_CREATE_WINDOW_MS });
		}

		const result = await this.dkgService.createWithDKG({
			name: body.name,
			type: body.type ?? SignerType.AI_AGENT,
			scheme: body.scheme ?? SchemeName.CGGMP24,
			network: body.network ?? 'base-sepolia',
		});

		this.logger.log(`Public signer created: ${result.signerId} (${result.ethAddress})`);

		return result;
	}

	@Get()
	@UseGuards(EitherAuthGuard)
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
	@UseGuards(EitherAuthGuard)
	async get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
		return signerToPublic(await this.getOwnedSigner(id, req));
	}

	@Patch(':id')
	@UseGuards(EitherAdminGuard)
	async update(
		@Param('id') id: string,
		@Body() body: UpdateSignerDto,
		@Req() req: AuthenticatedRequest,
	) {
		await this.getOwnedSigner(id, req);
		return signerToPublic(await this.signerService.update(id, body));
	}

	@Delete(':id')
	@UseGuards(EitherAdminGuard)
	async revoke(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
		await this.getOwnedSigner(id, req);
		return signerToPublic(await this.signerService.revoke(id));
	}

	@Post(':id/regenerate-key')
	@UseGuards(EitherAdminGuard)
	async regenerateApiKey(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
		await this.getOwnedSigner(id, req);
		const result = await this.signerService.regenerateApiKey(id);
		return { signer: signerToPublic(result.signer), apiKey: result.apiKey };
	}

	@Post(':id/pause')
	@UseGuards(EitherAdminGuard)
	async pause(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
		await this.getOwnedSigner(id, req);
		return signerToPublic(await this.signerService.pause(id));
	}

	@Post(':id/resume')
	@UseGuards(EitherAdminGuard)
	async resume(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
		await this.getOwnedSigner(id, req);
		return signerToPublic(await this.signerService.resume(id));
	}

	@Get(':id/balance')
	@UseGuards(EitherAuthGuard)
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

		let networks: Network[];
		if (chainIdFilter) {
			networks = [await this.networkService.getByChainId(Number(chainIdFilter))];
		} else if (networkFilter) {
			networks = [await this.networkService.getByName(networkFilter)];
		} else {
			networks = await this.networkService.listEnabled();
		}

		// Race all networks — return whatever responds within 3s, drop the rest
		const RPC_TIMEOUT = 3_000;
		const timeout = (ms: number) =>
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

		const results = await Promise.allSettled(
			networks.map(async (n) => {
				const chain = await this.chainRegistry.getChain(n.chainId);
				const wei = await Promise.race([chain.getBalance(signer.ethAddress), timeout(RPC_TIMEOUT)]);
				return { network: n.name, chainId: n.chainId, balance: wei.toString() };
			}),
		);

		const balances = results.map((r, i) => {
			if (r.status === 'fulfilled') return r.value;
			const n = networks[i] ?? { name: 'unknown', chainId: 0 };
			const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
			this.logger.warn(`RPC failed for ${n.name} (chainId=${n.chainId}): ${reason}`);
			return { network: n.name, chainId: n.chainId, balance: '0', rpcError: true };
		});

		const response = { address: signer.ethAddress, balances };
		balanceCache.set(cacheKey, { data: response, ts: Date.now() });
		return response;
	}

	@Post(':id/simulate')
	@UseGuards(EitherAuthGuard)
	async simulate(
		@Param('id') id: string,
		@Body() body: SimulateDto,
		@Req() req: AuthenticatedRequest,
	) {
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
	@UseGuards(SessionGuard)
	async storeUserShare(
		@Param('id') id: string,
		@Body() body: StoreUserShareDto,
		@Req() req: AuthenticatedRequest,
	) {
		await this.getOwnedSigner(id, req);
		const json = JSON.stringify(body);
		const bytes = new TextEncoder().encode(json);
		await this.shareStore.storeShare(`user-encrypted/${id}`, bytes);
		return { success: true };
	}

	@Get(':id/user-share')
	@UseGuards(SessionGuard)
	async getUserShare(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
		await this.getOwnedSigner(id, req);
		try {
			const bytes = await this.shareStore.getShare(`user-encrypted/${id}`);
			const json = new TextDecoder().decode(bytes);
			const blob = JSON.parse(json);
			this.logger.log(
				`getUserShare: sessionUser=${req.sessionUser}, blob.walletAddress=${blob.walletAddress}, iv=${blob.iv?.slice(0, 20)}, salt=${blob.salt?.slice(0, 20)}, ct_len=${blob.ciphertext?.length}`,
			);
			if (
				req.sessionUser &&
				blob.walletAddress &&
				req.sessionUser.toLowerCase() !== blob.walletAddress.toLowerCase()
			) {
				this.logger.warn(
					`getUserShare: walletAddress MISMATCH — session=${req.sessionUser} vs stored=${blob.walletAddress}`,
				);
				throw new ForbiddenException('Wallet address mismatch');
			}
			return blob;
		} catch (error: unknown) {
			if (error instanceof HttpException) throw error;
			this.logger.error(`getUserShare: share store read failed for user-encrypted/${id}:`, error);
			throw new HttpException('User share not found', HttpStatus.NOT_FOUND);
		}
	}

	/* ================================================================ */
	/*  Token tracking                                                   */
	/* ================================================================ */

	@Get(':id/tokens')
	@UseGuards(EitherAuthGuard)
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
	@UseGuards(EitherAuthGuard)
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
	@UseGuards(SessionGuard)
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
	@UseGuards(SessionGuard)
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
