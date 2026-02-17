import type {
	ChainName,
	NetworkName,
	SchemeName,
	Signer,
	SignerStatus,
	SignerType,
} from '@agentokratia/guardian-core';

export interface SignerRow {
	id: string;
	name: string;
	description: string | null;
	type: string;
	eth_address: string;
	chain: string;
	scheme: string;
	network: string | null;
	status: string;
	owner_address: string;
	api_key_hash: string;
	vault_share_path: string;
	dkg_completed: boolean;
	created_at: string;
	updated_at: string;
	last_active_at: string | null;
	revoked_at: string | null;
}

export interface CreateSignerData {
	name: string;
	description?: string;
	type: string;
	ethAddress: string;
	chain: string;
	scheme: string;
	network?: string;
	ownerAddress: string;
	apiKeyHash: string;
	vaultSharePath: string;
}

export function signerRowToDomain(row: SignerRow): Signer {
	return {
		id: row.id,
		name: row.name,
		description: row.description ?? undefined,
		type: row.type as SignerType,
		ethAddress: row.eth_address,
		chain: row.chain as ChainName,
		scheme: row.scheme as SchemeName,
		network: row.network ? (row.network as NetworkName) : undefined,
		status: row.status as SignerStatus,
		ownerAddress: row.owner_address,
		apiKeyHash: row.api_key_hash,
		vaultSharePath: row.vault_share_path,
		dkgCompleted: row.dkg_completed,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		lastActiveAt: row.last_active_at ?? undefined,
		revokedAt: row.revoked_at ?? undefined,
	};
}

/** Strip internal fields before returning to clients. */
export function signerToPublic(
	signer: Signer,
): Omit<Signer, 'apiKeyHash' | 'vaultSharePath' | 'ownerAddress'> {
	const { apiKeyHash: _, vaultSharePath: __, ownerAddress: ___, ...pub } = signer;
	return pub;
}

export function signerDomainToRow(signer: Partial<Signer>): Partial<SignerRow> {
	const row: Partial<SignerRow> = {};
	if (signer.name !== undefined) row.name = signer.name;
	if (signer.description !== undefined) row.description = signer.description ?? null;
	if (signer.type !== undefined) row.type = signer.type;
	if (signer.ethAddress !== undefined) row.eth_address = signer.ethAddress;
	if (signer.chain !== undefined) row.chain = signer.chain;
	if (signer.scheme !== undefined) row.scheme = signer.scheme;
	if (signer.network !== undefined) row.network = signer.network;
	if (signer.status !== undefined) row.status = signer.status;
	if (signer.apiKeyHash !== undefined) row.api_key_hash = signer.apiKeyHash;
	if (signer.vaultSharePath !== undefined) row.vault_share_path = signer.vaultSharePath;
	if (signer.ownerAddress !== undefined) row.owner_address = signer.ownerAddress;
	if (signer.dkgCompleted !== undefined) row.dkg_completed = signer.dkgCompleted;
	return row;
}
