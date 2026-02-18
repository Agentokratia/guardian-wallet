import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GuardianApi } from '../guardian-api.js';
import type { HttpClient } from '../http-client.js';

function mockClient(): HttpClient {
	return {
		get: vi.fn(),
		post: vi.fn(),
	} as unknown as HttpClient;
}

describe('GuardianApi', () => {
	let client: HttpClient;
	let api: GuardianApi;

	beforeEach(() => {
		client = mockClient();
		api = new GuardianApi(client);
	});

	// -- Health ---------------------------------------------------------------

	describe('getHealth', () => {
		it('returns health from /health', async () => {
			const expected = { status: 'ok', uptime: 42 };
			vi.mocked(client.get).mockResolvedValueOnce(expected);

			const result = await api.getHealth();
			expect(result).toEqual(expected);
			expect(client.get).toHaveBeenCalledWith('/health');
		});

		it('falls back to /api/v1/health when /health fails', async () => {
			const expected = { status: 'ok' };
			vi.mocked(client.get).mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce(expected);

			const result = await api.getHealth();
			expect(result).toEqual(expected);
			expect(client.get).toHaveBeenCalledWith('/api/v1/health');
		});
	});

	// -- Signers --------------------------------------------------------------

	describe('listSigners', () => {
		it('returns signers from the API', async () => {
			const signers = [{ id: '1', name: 'bot-1', ethAddress: '0xabc' }];
			vi.mocked(client.get).mockResolvedValueOnce(signers);

			const result = await api.listSigners();
			expect(result).toEqual(signers);
			expect(client.get).toHaveBeenCalledWith('/api/v1/signers');
		});
	});

	describe('getDefaultSigner', () => {
		it('returns the first signer', async () => {
			const signers = [
				{ id: '1', name: 'first' },
				{ id: '2', name: 'second' },
			];
			vi.mocked(client.get).mockResolvedValueOnce(signers);

			const result = await api.getDefaultSigner();
			expect(result.id).toBe('1');
		});

		it('throws when no signers exist', async () => {
			vi.mocked(client.get).mockResolvedValueOnce([]);
			await expect(api.getDefaultSigner()).rejects.toThrow('No signers found');
		});
	});

	// -- Balances -------------------------------------------------------------

	describe('getBalance', () => {
		it('calls the correct URL', async () => {
			const balance = { address: '0x1', balances: [] };
			vi.mocked(client.get).mockResolvedValueOnce(balance);

			await api.getBalance('signer-1', 'base-sepolia');
			expect(client.get).toHaveBeenCalledWith(
				'/api/v1/signers/signer-1/balance?network=base-sepolia',
			);
		});
	});

	// -- Networks (cached) ----------------------------------------------------

	describe('listNetworks', () => {
		it('returns networks from the API', async () => {
			const networks = [{ name: 'sepolia', chainId: 11155111 }];
			vi.mocked(client.get).mockResolvedValueOnce(networks);

			const result = await api.listNetworks();
			expect(result).toEqual(networks);
		});

		it('caches networks for 60s', async () => {
			const networks = [{ name: 'sepolia', chainId: 11155111 }];
			vi.mocked(client.get).mockResolvedValueOnce(networks);

			await api.listNetworks();
			const result = await api.listNetworks();
			expect(result).toEqual(networks);
			// Only called once — second call is cached
			expect(client.get).toHaveBeenCalledTimes(1);
		});

		it('returns empty on error with no cache', async () => {
			vi.mocked(client.get).mockRejectedValueOnce(new Error('offline'));
			const result = await api.listNetworks();
			expect(result).toEqual([]);
		});
	});

	describe('getExplorerTxUrl', () => {
		it('builds explorer URL from network info', async () => {
			const networks = [
				{ name: 'sepolia', explorerUrl: 'https://sepolia.etherscan.io', chainId: 11155111 },
			];
			vi.mocked(client.get).mockResolvedValueOnce(networks);

			const url = await api.getExplorerTxUrl('sepolia', '0xabc');
			expect(url).toBe('https://sepolia.etherscan.io/tx/0xabc');
		});

		it('returns null when no explorer configured', async () => {
			vi.mocked(client.get).mockResolvedValueOnce([]);
			const url = await api.getExplorerTxUrl('unknown', '0xdef');
			expect(url).toBeNull();
		});
	});

	// -- Policies -------------------------------------------------------------

	describe('getPolicies', () => {
		it('returns policy info from /policy endpoint', async () => {
			const policies = { rules: [{ type: 'rate_limit', config: {}, enabled: true }] };
			vi.mocked(client.get).mockResolvedValueOnce(policies);

			const result = await api.getPolicies('signer-1');
			expect(result.rules).toHaveLength(1);
			expect(client.get).toHaveBeenCalledWith('/api/v1/signers/signer-1/policy');
		});

		it('falls back to /policies endpoint', async () => {
			const rules = [{ type: 'spending_limit', config: {}, enabled: true }];
			vi.mocked(client.get).mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce(rules);

			const result = await api.getPolicies('signer-1');
			expect(result.rules).toHaveLength(1);
			expect(client.get).toHaveBeenCalledWith('/api/v1/signers/signer-1/policies');
		});
	});

	// -- Audit ----------------------------------------------------------------

	describe('getAuditLog', () => {
		it('parses paginated response', async () => {
			const response = {
				data: [
					{ createdAt: '2024-01-01', status: 'completed', requestType: 'tx', signingPath: 'cli' },
				],
				meta: { total: 100, page: 1, limit: 20, totalPages: 5 },
			};
			vi.mocked(client.get).mockResolvedValueOnce(response);

			const result = await api.getAuditLog({ limit: 20, page: 1 });
			expect(result.entries).toHaveLength(1);
			expect(result.meta?.total).toBe(100);
		});

		it('handles array response (legacy)', async () => {
			const entries = [
				{ createdAt: '2024-01-01', status: 'completed', requestType: 'tx', signingPath: 'cli' },
			];
			vi.mocked(client.get).mockResolvedValueOnce(entries);

			const result = await api.getAuditLog();
			expect(result.entries).toHaveLength(1);
			expect(result.meta).toBeUndefined();
		});
	});

	// -- Simulate -------------------------------------------------------------

	describe('simulate', () => {
		it('calls POST with correct body', async () => {
			const simResult = { success: true, estimatedGas: '21000', gasCostEth: '0.0001' };
			vi.mocked(client.post).mockResolvedValueOnce(simResult);

			const tx = { to: '0x1', value: '1000', network: 'sepolia' };
			const result = await api.simulate('signer-1', tx);
			expect(result.success).toBe(true);
			expect(client.post).toHaveBeenCalledWith('/api/v1/signers/signer-1/simulate', tx);
		});
	});

	// -- Resolve address (without ENS) ----------------------------------------

	describe('resolveAddress', () => {
		it('returns hex address directly', async () => {
			const result = await api.resolveAddress('0x1234567890abcdef1234567890abcdef12345678');
			expect(result.isEns).toBe(false);
			expect(result.address).toBe('0x1234567890abcdef1234567890abcdef12345678');
		});

		it('throws for invalid address', async () => {
			await expect(api.resolveAddress('not-an-address')).rejects.toThrow('Invalid address');
		});
	});

	// -- Resolve token --------------------------------------------------------

	describe('resolveToken', () => {
		it('returns hex address as-is', async () => {
			const result = await api.resolveToken(
				'0x1234567890abcdef1234567890abcdef12345678',
				'signer-1',
				1,
			);
			expect(result.resolvedBySymbol).toBe(false);
			expect(result.address).toBe('0x1234567890abcdef1234567890abcdef12345678');
		});

		it('resolves symbol to address', async () => {
			const tokens = [
				{
					address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
					symbol: 'USDC',
					decimals: 6,
					name: 'USD Coin',
					id: 't1',
					chainId: 1,
				},
			];
			vi.mocked(client.get).mockResolvedValueOnce(tokens);

			const result = await api.resolveToken('usdc', 'signer-1', 1);
			expect(result.resolvedBySymbol).toBe(true);
			expect(result.symbol).toBe('USDC');
			expect(result.decimals).toBe(6);
		});

		it('throws for unknown symbol', async () => {
			vi.mocked(client.get).mockResolvedValueOnce([]);
			await expect(api.resolveToken('FAKE', 'signer-1', 1)).rejects.toThrow('Unknown token');
		});
	});

	// -- Cache control --------------------------------------------------------

	describe('clearNetworkCache', () => {
		it('forces re-fetch after clearing', async () => {
			const networks = [{ name: 'sepolia', chainId: 11155111 }];
			vi.mocked(client.get).mockResolvedValue(networks);

			await api.listNetworks();
			api.clearNetworkCache();
			await api.listNetworks();

			// get() called twice — once before cache, once after clear
			expect(client.get).toHaveBeenCalledTimes(2);
		});
	});
});
