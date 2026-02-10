import type { ChainName } from '../enums/chain-name.js';
import type { NetworkName } from '../enums/network-name.js';
import type { SchemeName } from '../enums/scheme-name.js';
import type { SignerStatus } from '../enums/signer-status.js';
import type { SignerType } from '../enums/signer-type.js';

export interface Signer {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly type: SignerType;
	readonly ethAddress: string;
	readonly chain: ChainName;
	readonly scheme: SchemeName;
	readonly network?: NetworkName;
	readonly status: SignerStatus;
	readonly ownerAddress: string;
	readonly apiKeyHash: string;
	readonly vaultSharePath: string;
	readonly dkgCompleted: boolean;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly lastActiveAt?: string;
	readonly revokedAt?: string;
}
