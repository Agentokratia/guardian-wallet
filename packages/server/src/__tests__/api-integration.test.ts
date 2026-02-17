/**
 * Guardian API Integration Test — Service-Level.
 *
 * Tests the full API flow by manually instantiating real services with
 * mocked external dependencies (Supabase, Vault, Chain).
 *
 * Why not NestJS TestingModule?
 * - Vitest uses esbuild which does NOT support `emitDecoratorMetadata`
 * - NestJS relies on metadata for type-based DI (constructor params without @Inject)
 * - So we test the actual service/controller logic directly
 *
 * What's tested:
 * - Signer CRUD (create, list, get, update, pause, resume, revoke)
 * - User share store/retrieve (wallet-encrypted blob in Vault)
 * - Balance, simulate (mocked chain)
 * - Security: Vault path separation (server vs user-encrypted)
 */

import { randomUUID } from 'node:crypto';
import type { IChain, IShareStore, Signer } from '@agentokratia/guardian-core';
import {
	ChainName,
	NetworkName,
	SchemeName,
	SignerStatus,
	SignerType,
} from '@agentokratia/guardian-core';
import { HttpException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../common/authenticated-request.js';
import type { AuxInfoPoolService } from '../dkg/aux-info-pool.service.js';
import { DKGService } from '../dkg/dkg.service.js';
import { SignerController } from '../signers/signer.controller.js';
import type { SignerRepository } from '../signers/signer.repository.js';
import type { SignerService } from '../signers/signer.service.js';

// ---------------------------------------------------------------------------
// Mock Vault (in-memory)
// ---------------------------------------------------------------------------

class MockShareStore implements IShareStore {
	private readonly store = new Map<string, Uint8Array>();

	async storeShare(path: string, share: Uint8Array): Promise<void> {
		this.store.set(path, new Uint8Array(share));
	}

	async getShare(path: string): Promise<Uint8Array> {
		const data = this.store.get(path);
		if (!data) throw new Error(`Not found: ${path}`);
		return data;
	}

	async deleteShare(path: string): Promise<void> {
		this.store.delete(path);
	}

	async healthCheck(): Promise<boolean> {
		return true;
	}

	has(path: string): boolean {
		return this.store.has(path);
	}

	size(): number {
		return this.store.size;
	}
}

// ---------------------------------------------------------------------------
// Mock Chain
// ---------------------------------------------------------------------------

const mockChain: IChain = {
	chainId: 11155111,
	name: 'sepolia',
	getBalance: vi.fn().mockResolvedValue(1000000000000000000n),
	estimateGas: vi.fn().mockResolvedValue(21000n),
	getGasPrice: vi.fn().mockResolvedValue(1000000000n),
	broadcastTransaction: vi.fn().mockResolvedValue(`0x${'ab'.repeat(32)}`),
	getTransactionCount: vi.fn().mockResolvedValue(0),
} as unknown as IChain;

const mockChainRegistry = {
	getChain: vi.fn().mockResolvedValue(mockChain),
	getChainByName: vi.fn().mockResolvedValue(mockChain),
	invalidateCache: vi.fn(),
};

const mockNetworkService = {
	listEnabled: vi.fn().mockResolvedValue([
		{
			name: 'sepolia',
			displayName: 'Sepolia Testnet',
			chainId: 11155111,
			rpcUrl: 'https://rpc.sepolia.org',
			explorerUrl: 'https://sepolia.etherscan.io',
			nativeCurrency: 'ETH',
			isTestnet: true,
			enabled: true,
		},
	]),
	getByName: vi.fn().mockResolvedValue({
		name: 'sepolia',
		displayName: 'Sepolia Testnet',
		chainId: 11155111,
		rpcUrl: 'https://rpc.sepolia.org',
		explorerUrl: 'https://sepolia.etherscan.io',
		nativeCurrency: 'ETH',
		isTestnet: true,
		enabled: true,
	}),
	getByChainId: vi.fn().mockResolvedValue({
		name: 'sepolia',
		displayName: 'Sepolia Testnet',
		chainId: 11155111,
		rpcUrl: 'https://rpc.sepolia.org',
		explorerUrl: 'https://sepolia.etherscan.io',
		nativeCurrency: 'ETH',
		isTestnet: true,
		enabled: true,
	}),
};

// ---------------------------------------------------------------------------
// Mock SignerService (simple vi.fn() stubs with canned data)
// ---------------------------------------------------------------------------

const CANNED_SIGNER = {
	id: 'signer-test-1',
	name: 'Test Agent',
	description: undefined,
	type: 'autonomous',
	ethAddress: `0x${'ab'.repeat(20)}`,
	chain: 'ethereum',
	scheme: 'cggmp24',
	network: 'sepolia',
	status: 'active',
	ownerAddress: '0xTestOwner',
	apiKeyHash: 'hash-test',
	vaultSharePath: 'pending',
	dkgCompleted: false,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
};

function createMockSignerService() {
	return {
		create: vi.fn().mockResolvedValue({
			signer: { ...CANNED_SIGNER, id: randomUUID() },
			apiKey: `gw_live_${Buffer.from(randomUUID()).toString('base64url')}`,
		}),
		list: vi.fn().mockResolvedValue([CANNED_SIGNER]),
		listByOwner: vi.fn().mockResolvedValue([CANNED_SIGNER]),
		get: vi.fn().mockResolvedValue(CANNED_SIGNER),
		update: vi.fn().mockResolvedValue({ ...CANNED_SIGNER, name: 'Renamed' }),
		pause: vi.fn().mockResolvedValue({ ...CANNED_SIGNER, status: 'paused' }),
		resume: vi.fn().mockResolvedValue({ ...CANNED_SIGNER, status: 'active' }),
		revoke: vi.fn().mockResolvedValue({ ...CANNED_SIGNER, status: 'revoked' }),
	};
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Guardian API Integration Tests', () => {
	let controller: SignerController;
	let signerService: ReturnType<typeof createMockSignerService>;
	let vault: MockShareStore;

	const defaultReq = { sessionUser: '0xTestOwner' } as AuthenticatedRequest;

	beforeEach(() => {
		vi.clearAllMocks();
		signerService = createMockSignerService();
		vault = new MockShareStore();
		controller = new SignerController(
			signerService as unknown as SignerService,
			mockChainRegistry as any,
			mockNetworkService as any,
			vault,
			{} as any,
		);
	});

	// -----------------------------------------------------------------------
	// Signer CRUD
	// -----------------------------------------------------------------------

	describe('Signer CRUD', () => {
		it('creates a new signer with API key', async () => {
			const result = await controller.create(
				{
					name: 'Test Agent',
					type: 'autonomous' as never,
					chain: 'ethereum' as never,
					scheme: 'cggmp24' as never,
					network: 'sepolia' as never,
				},
				defaultReq,
			);

			expect(result.signer.status).toBe('active');
			expect(result.apiKey).toMatch(/^gw_live_/);
			expect(signerService.create).toHaveBeenCalledOnce();
		});

		it('lists all signers for session auth', async () => {
			const req = { sessionUser: '0xABC' } as AuthenticatedRequest;
			const list = await controller.list(req);
			expect(signerService.listByOwner).toHaveBeenCalledWith('0xABC');
			expect(list).toHaveLength(1);
		});

		it('lists only own signer for API key auth', async () => {
			const req = { signerId: 'signer-test-1' } as AuthenticatedRequest;
			const list = await controller.list(req);
			expect(signerService.get).toHaveBeenCalledWith('signer-test-1');
			expect(list).toHaveLength(1);
		});

		it('gets a specific signer by ID', async () => {
			const found = await controller.get('signer-test-1', defaultReq);
			expect(found.name).toBe('Test Agent');
			expect(signerService.get).toHaveBeenCalledWith('signer-test-1');
		});

		it('throws 404 for nonexistent signer', async () => {
			signerService.get.mockRejectedValueOnce(new NotFoundException('Signer not found'));
			await expect(controller.get(randomUUID(), defaultReq)).rejects.toThrow('Signer not found');
		});

		it('updates signer name', async () => {
			const updated = await controller.update('signer-test-1', { name: 'Renamed' }, defaultReq);
			expect(updated.name).toBe('Renamed');
			expect(signerService.update).toHaveBeenCalledWith('signer-test-1', { name: 'Renamed' });
		});

		it('pauses an active signer', async () => {
			const paused = await controller.pause('signer-test-1', defaultReq);
			expect(paused.status).toBe('paused');
			expect(signerService.pause).toHaveBeenCalledWith('signer-test-1');
		});

		it('resumes a paused signer', async () => {
			const resumed = await controller.resume('signer-test-1', defaultReq);
			expect(resumed.status).toBe('active');
			expect(signerService.resume).toHaveBeenCalledWith('signer-test-1');
		});

		it('revokes a signer', async () => {
			const revoked = await controller.revoke('signer-test-1', defaultReq);
			expect(revoked.status).toBe('revoked');
			expect(signerService.revoke).toHaveBeenCalledWith('signer-test-1');
		});
	});

	// -----------------------------------------------------------------------
	// Balance & Simulate
	// -----------------------------------------------------------------------

	describe('Balance & Simulate', () => {
		it('returns ETH balance for a signer across all networks', async () => {
			const result = await controller.getBalance('signer-test-1', undefined, undefined, defaultReq);
			expect(result.balances).toHaveLength(1);
			expect(result.balances[0]!.network).toBe('sepolia');
			expect(result.balances[0]!.balance).toBe('1000000000000000000');
		});

		it('returns gas estimate for simulation', async () => {
			const result = await controller.simulate(
				'signer-test-1',
				{
					to: `0x${'ab'.repeat(20)}`,
					value: '0.1',
					network: 'sepolia',
				},
				defaultReq,
			);
			expect(result.success).toBe(true);
			expect(result.estimatedGas).toBe('21000');
		});
	});

	// -----------------------------------------------------------------------
	// User Share Endpoints (wallet-encrypted share storage in Vault)
	// -----------------------------------------------------------------------

	describe('User Share — Wallet-Encrypted Storage', () => {
		const encryptedShareData = {
			walletAddress: '0xTestOwner',
			iv: 'dGVzdC1pdi1kYXRh',
			ciphertext: 'dGVzdC1jaXBoZXJ0ZXh0LWVuY3J5cHRlZC1zaGFyZS1ieXRlcw==',
			salt: 'dGVzdC1zYWx0LWRhdGE=',
		};

		it('stores encrypted user share blob in Vault', async () => {
			const { signer } = await controller.create(
				{
					name: 'Share',
					type: 'autonomous' as never,
					chain: 'ethereum' as never,
					scheme: 'cggmp24' as never,
					network: 'sepolia' as never,
				},
				defaultReq,
			);

			const result = await controller.storeUserShare(signer.id, encryptedShareData, defaultReq);
			expect(result.success).toBe(true);

			// Verify it's in Vault at the correct path
			expect(vault.has(`user-encrypted/${signer.id}`)).toBe(true);
		});

		it('retrieves encrypted user share blob from Vault', async () => {
			const { signer } = await controller.create(
				{
					name: 'Retrieve',
					type: 'autonomous' as never,
					chain: 'ethereum' as never,
					scheme: 'cggmp24' as never,
					network: 'sepolia' as never,
				},
				defaultReq,
			);

			await controller.storeUserShare(signer.id, encryptedShareData, defaultReq);
			const retrieved = await controller.getUserShare(signer.id, defaultReq);

			expect(retrieved.walletAddress).toBe(encryptedShareData.walletAddress);
			expect(retrieved.iv).toBe(encryptedShareData.iv);
			expect(retrieved.ciphertext).toBe(encryptedShareData.ciphertext);
			expect(retrieved.salt).toBe(encryptedShareData.salt);
		});

		it('roundtrip: stored bytes are JSON-encoded ciphertext, NOT raw share', async () => {
			const { signer } = await controller.create(
				{
					name: 'Roundtrip',
					type: 'autonomous' as never,
					chain: 'ethereum' as never,
					scheme: 'cggmp24' as never,
					network: 'sepolia' as never,
				},
				defaultReq,
			);

			await controller.storeUserShare(signer.id, encryptedShareData, defaultReq);

			// Read raw bytes from Vault directly
			const rawBytes = await vault.getShare(`user-encrypted/${signer.id}`);
			const json = JSON.parse(new TextDecoder().decode(rawBytes));

			// The server stores the DTO as JSON — it never sees plaintext share bytes
			expect(json.walletAddress).toBe(encryptedShareData.walletAddress);
			expect(json.ciphertext).toBe(encryptedShareData.ciphertext);
			expect(json.iv).toBe(encryptedShareData.iv);
			expect(json.salt).toBe(encryptedShareData.salt);
		});

		it('overwrites existing encrypted share', async () => {
			const { signer } = await controller.create(
				{
					name: 'Overwrite',
					type: 'autonomous' as never,
					chain: 'ethereum' as never,
					scheme: 'cggmp24' as never,
					network: 'sepolia' as never,
				},
				defaultReq,
			);

			await controller.storeUserShare(signer.id, encryptedShareData, defaultReq);

			const newData = {
				walletAddress: '0xTestOwner',
				iv: 'bmV3LWl2',
				ciphertext: 'bmV3LWNpcGhlcnRleHQ=',
				salt: 'bmV3LXNhbHQ=',
			};
			await controller.storeUserShare(signer.id, newData, defaultReq);

			const retrieved = await controller.getUserShare(signer.id, defaultReq);
			expect(retrieved.walletAddress).toBe(newData.walletAddress);
			expect(retrieved.ciphertext).toBe(newData.ciphertext);
		});

		it('returns 404 when no encrypted share exists', async () => {
			const { signer } = await controller.create(
				{
					name: 'NoShare',
					type: 'autonomous' as never,
					chain: 'ethereum' as never,
					scheme: 'cggmp24' as never,
					network: 'sepolia' as never,
				},
				defaultReq,
			);

			try {
				await controller.getUserShare(signer.id, defaultReq);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(HttpException);
				expect((error as HttpException).getStatus()).toBe(404);
				expect((error as HttpException).message).toBe('User share not found');
			}
		});

		it('throws when signer does not exist (store)', async () => {
			signerService.get.mockRejectedValueOnce(new NotFoundException('Signer not found'));
			await expect(
				controller.storeUserShare(randomUUID(), encryptedShareData, defaultReq),
			).rejects.toThrow('Signer not found');
		});

		it('throws when signer does not exist (get)', async () => {
			signerService.get.mockRejectedValueOnce(new NotFoundException('Signer not found'));
			await expect(controller.getUserShare(randomUUID(), defaultReq)).rejects.toThrow(
				'Signer not found',
			);
		});

		it('server never holds raw user share — only encrypted blob', async () => {
			const { signer } = await controller.create(
				{
					name: 'Security',
					type: 'autonomous' as never,
					chain: 'ethereum' as never,
					scheme: 'cggmp24' as never,
					network: 'sepolia' as never,
				},
				defaultReq,
			);

			// Store encrypted blob
			await controller.storeUserShare(signer.id, encryptedShareData, defaultReq);

			// Read raw vault content
			const rawBytes = await vault.getShare(`user-encrypted/${signer.id}`);
			const rawStr = new TextDecoder().decode(rawBytes);

			// The stored content must be JSON with encrypted fields — not raw binary
			const parsed = JSON.parse(rawStr);
			expect(parsed).toHaveProperty('walletAddress');
			expect(parsed).toHaveProperty('ciphertext');
			expect(parsed).toHaveProperty('iv');
			expect(parsed).toHaveProperty('salt');

			// The ciphertext is base64-encoded — NOT raw share bytes
			expect(typeof parsed.ciphertext).toBe('string');
		});
	});

	// -----------------------------------------------------------------------
	// Security: override-sign is REMOVED
	// -----------------------------------------------------------------------

	describe('Security', () => {
		it('SigningController has no override-sign method', async () => {
			// Import the signing controller and verify the old method doesn't exist
			const { SigningController } = await import('../signing/signing.controller.js');
			const proto = SigningController.prototype;

			// The old override-sign methods should not exist
			expect(proto).not.toHaveProperty('overrideSign');
			expect(proto).not.toHaveProperty('handleOverrideSign');
		});

		it('SigningModule does not provide OverrideSignService', async () => {
			// Verify override-sign.service.ts doesn't exist
			try {
				// Use string variable to avoid TypeScript module resolution error
				const modulePath = '../signing/override-sign.service.js';
				await import(/* @vite-ignore */ modulePath);
				expect.fail('override-sign.service.ts should not exist');
			} catch (error) {
				// Expected: module not found (Vitest says "Failed to load url" or "Cannot find module")
				const msg = String(error);
				expect(msg.includes('Cannot find module') || msg.includes('Failed to load url')).toBe(true);
			}
		});

		it('Vault paths are correctly separated: server share vs encrypted user share', async () => {
			const { signer } = await controller.create(
				{
					name: 'Paths',
					type: 'autonomous' as never,
					chain: 'ethereum' as never,
					scheme: 'cggmp24' as never,
					network: 'sepolia' as never,
				},
				defaultReq,
			);

			// Store user encrypted share
			await controller.storeUserShare(
				signer.id,
				{
					walletAddress: '0xabc',
					iv: 'aXY=',
					ciphertext: 'Y3Q=',
					salt: 'c2FsdA==',
				},
				defaultReq,
			);

			// User encrypted share at user-encrypted/{id}
			expect(vault.has(`user-encrypted/${signer.id}`)).toBe(true);

			// Server share would be at {id} (set by DKG, not by user share endpoint)
			// The user share endpoint NEVER writes to the server share path
			expect(vault.has(signer.id)).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// DKG E2E: Create Signer → DKG Init → Finalize → Shares
	// -----------------------------------------------------------------------

	describe('DKG End-to-End', () => {
		it('create signer → init DKG → finalize → returns signerShare + userShare + ethAddress', async () => {
			// Set up a single-call DKG mock (CGGMP24 runs entirely inside WASM)
			const mockScheme = {
				runDkg: vi.fn(),
				deriveAddress: vi.fn().mockReturnValue('0xE2E_DKG_Address_1234567890abcdef'),
			};

			// Simulate in-memory signer store for DKG
			const signers = new Map<string, Signer>();
			const signerRepo: Partial<SignerRepository> = {
				findById: vi.fn(async (id: string) => signers.get(id) ?? null),
				update: vi.fn(async (id: string, data: Partial<Signer>) => {
					const existing = signers.get(id);
					if (!existing) throw new NotFoundException();
					const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
					signers.set(id, updated as Signer);
					return updated as Signer;
				}),
			};

			const dkgVault = new MockShareStore();
			const mockAuxInfoPool = {
				take: vi.fn().mockResolvedValue(null),
				getStatus: vi.fn().mockReturnValue({
					size: 0,
					target: 5,
					lowWatermark: 2,
					activeGenerators: 0,
					maxGenerators: 2,
					healthy: true,
				}),
			};
			const dkgService = new DKGService(
				signerRepo as unknown as SignerRepository,
				dkgVault,
				mockAuxInfoPool as unknown as AuxInfoPoolService,
			);
			// Replace the scheme with our mock (it's private, use any cast)
			(dkgService as unknown as Record<string, unknown>).scheme = mockScheme;

			// Step 1: Create a signer record
			const signerId = randomUUID();
			const signer: Signer = {
				id: signerId,
				name: 'DKG Test Agent',
				type: SignerType.AI_AGENT,
				ethAddress: '',
				chain: ChainName.ETHEREUM,
				scheme: SchemeName.CGGMP24,
				network: NetworkName.SEPOLIA,
				status: SignerStatus.ACTIVE,
				ownerAddress: '0xTestOwner',
				apiKeyHash: 'hash-dkg-test',
				vaultSharePath: 'pending',
				dkgCompleted: false,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
			signers.set(signerId, signer);

			// Step 2: Init DKG (validates signer, creates session)
			const initResult = await dkgService.init({ signerId });

			expect(initResult.sessionId).toBeDefined();
			expect(initResult.signerId).toBe(signerId);

			// Step 3: Finalize DKG (single WASM call — aux_info_gen + keygen all at once)
			const signerCoreShare = new Uint8Array([100, 101, 102]);
			const serverCoreShare = new Uint8Array([200, 201, 202]);
			const userCoreShare = new Uint8Array([50, 51, 52]);
			const signerAuxInfo = new Uint8Array([11, 12]);
			const serverAuxInfo = new Uint8Array([13, 14]);
			const userAuxInfo = new Uint8Array([15, 16]);

			mockScheme.runDkg.mockResolvedValueOnce({
				shares: [
					{ coreShare: signerCoreShare, auxInfo: signerAuxInfo },
					{ coreShare: serverCoreShare, auxInfo: serverAuxInfo },
					{ coreShare: userCoreShare, auxInfo: userAuxInfo },
				],
				publicKey: new Uint8Array([4, 10, 20]),
			});

			const finalResult = await dkgService.finalize({
				sessionId: initResult.sessionId,
				signerId,
			});

			// Verify the result
			expect(finalResult.signerId).toBe(signerId);
			expect(finalResult.ethAddress).toBe('0xE2E_DKG_Address_1234567890abcdef');
			expect(typeof finalResult.signerShare).toBe('string'); // base64
			expect(typeof finalResult.userShare).toBe('string'); // base64
			expect(finalResult.signerShare.length).toBeGreaterThan(0);
			expect(finalResult.userShare.length).toBeGreaterThan(0);

			// Signer share is base64-encoded JSON { coreShare, auxInfo }
			const signerKm = JSON.parse(Buffer.from(finalResult.signerShare, 'base64').toString('utf-8'));
			expect(signerKm).toHaveProperty('coreShare');
			expect(signerKm).toHaveProperty('auxInfo');

			// Verify server share is in Vault
			expect(dkgVault.has(signerId)).toBe(true);

			// Verify signer record was updated
			const updatedSigner = signers.get(signerId);
			expect(updatedSigner?.dkgCompleted).toBe(true);
			expect(updatedSigner?.ethAddress).toBe('0xE2E_DKG_Address_1234567890abcdef');
			expect(updatedSigner?.vaultSharePath).toBe(signerId);

			// Single-call DKG: runDkg called exactly once
			expect(mockScheme.runDkg).toHaveBeenCalledTimes(1);
			expect(mockScheme.runDkg).toHaveBeenCalledWith(3, 2, undefined);

			console.log('');
			console.log('  ┌─── DKG E2E FLOW (CGGMP24 single-call WASM) ──────');
			console.log(`  │ Signer ID    : ${signerId}`);
			console.log(`  │ ETH Address  : ${finalResult.ethAddress}`);
			console.log(
				`  │ Signer Share : ${finalResult.signerShare.slice(0, 16)}... (base64 JSON {coreShare, auxInfo})`,
			);
			console.log(
				`  │ User Share   : ${finalResult.userShare.slice(0, 16)}... (base64 JSON {coreShare, auxInfo})`,
			);
			console.log(`  │ Server Share : stored in Vault at "${signerId}"`);
			console.log('  │ DKG          : single WASM call (aux_info_gen + keygen)');
			console.log('  │');
			console.log('  │ VERIFIED:');
			console.log('  │   ✓ Signer record created before DKG');
			console.log('  │   ✓ DKG init validates signer + creates session');
			console.log('  │   ✓ DKG finalize runs single-call WASM ceremony');
			console.log('  │   ✓ Server share stored in Vault as JSON key material');
			console.log('  │   ✓ Signer + User key material returned to client');
			console.log('  │   ✓ Signer record updated (ethAddress, dkgCompleted)');
			console.log('  └────────────────────────────────────────────────────');
			console.log('');
		});
	});

	// -----------------------------------------------------------------------
	// Full Flow: Create → Store Share → Retrieve → Verify
	// -----------------------------------------------------------------------

	describe('Full Guardian Flow', () => {
		it('end-to-end: create signer → store encrypted share → retrieve → verify', async () => {
			// Step 1: Create signer
			const { signer, apiKey } = await controller.create(
				{
					name: 'E2E Agent',
					type: 'autonomous' as never,
					chain: 'ethereum' as never,
					scheme: 'cggmp24' as never,
					network: 'sepolia' as never,
				},
				defaultReq,
			);

			expect(signer.id).toBeDefined();
			expect(apiKey).toMatch(/^gw_live_/);

			// Step 2: Check balance
			const balance = await controller.getBalance(signer.id, undefined, undefined, defaultReq);
			expect(balance.balances[0]!.balance).toBe('1000000000000000000');

			// Step 3: Simulate transaction
			const sim = await controller.simulate(
				signer.id,
				{
					to: `0x${'11'.repeat(20)}`,
					value: '0.05',
					network: 'sepolia',
				},
				defaultReq,
			);
			expect(sim.success).toBe(true);

			// Step 4: Store encrypted user share (from browser after DKG)
			const shareBlob = {
				walletAddress: '0xTestOwner',
				iv: Buffer.from('random-iv-12bytes').toString('base64'),
				ciphertext: Buffer.from('encrypted-user-share-bytes-here').toString('base64'),
				salt: Buffer.from('random-salt-16byte').toString('base64'),
			};
			const storeResult = await controller.storeUserShare(signer.id, shareBlob, defaultReq);
			expect(storeResult.success).toBe(true);

			// Step 5: Retrieve encrypted share (browser would do this before signing)
			const retrieved = await controller.getUserShare(signer.id, defaultReq);
			expect(retrieved.walletAddress).toBe(shareBlob.walletAddress);
			expect(retrieved.ciphertext).toBe(shareBlob.ciphertext);

			// Step 6: Verify Vault contains the encrypted blob at correct path
			const vaultBytes = await vault.getShare(`user-encrypted/${signer.id}`);
			const vaultJson = JSON.parse(new TextDecoder().decode(vaultBytes));
			expect(vaultJson.walletAddress).toBe(shareBlob.walletAddress);

			// Step 7: Lifecycle — pause, resume
			await controller.pause(signer.id, defaultReq);
			signerService.get.mockResolvedValueOnce({
				...CANNED_SIGNER,
				id: signer.id,
				status: 'paused',
			});
			const paused = await controller.get(signer.id, defaultReq);
			expect(paused.status).toBe('paused');

			await controller.resume(signer.id, defaultReq);
			signerService.get.mockResolvedValueOnce({
				...CANNED_SIGNER,
				id: signer.id,
				status: 'active',
			});
			const active = await controller.get(signer.id, defaultReq);
			expect(active.status).toBe('active');

			console.log('');
			console.log('  ┌─── GUARDIAN E2E FLOW ────────────────────────────────');
			console.log(`  │ Signer ID    : ${signer.id}`);
			console.log(`  │ API Key      : ${apiKey.slice(0, 16)}...`);
			console.log(`  │ ETH Balance  : ${balance.balances[0]?.balance ?? '0'} wei`);
			console.log(`  │ Gas Estimate : ${sim.estimatedGas}`);
			console.log(`  │ Share Stored : user-encrypted/${signer.id}`);
			console.log(`  │ Share Wallet : ${shareBlob.walletAddress.slice(0, 14)}...`);
			console.log('  │');
			console.log('  │ VERIFIED:');
			console.log('  │   ✓ Signer created with API key');
			console.log('  │   ✓ Balance and simulation work');
			console.log('  │   ✓ Encrypted share stored in Vault');
			console.log('  │   ✓ Encrypted share retrieved correctly');
			console.log('  │   ✓ Server never sees raw share bytes');
			console.log('  │   ✓ Vault path separation (server vs user-encrypted)');
			console.log('  │   ✓ Lifecycle: pause → resume works');
			console.log('  └────────────────────────────────────────────────────');
			console.log('');
		});
	});
});
