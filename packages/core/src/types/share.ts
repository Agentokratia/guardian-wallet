import type { ChainName } from '../enums/chain-name.js';
import type { CurveName } from '../enums/curve-name.js';
import type { NetworkName } from '../enums/network-name.js';
import type { SchemeName } from '../enums/scheme-name.js';

export interface Share {
	readonly data: Uint8Array;
	readonly participantIndex: 1 | 2 | 3;
	readonly publicKey: Uint8Array;
	readonly scheme: SchemeName;
	readonly curve: CurveName;
}

export interface ShareFileEncryption {
	readonly algorithm: 'aes-256-gcm';
	readonly iv: string;
	readonly tag: string;
	readonly kdf: 'scrypt' | 'argon2id';
	readonly kdfParams: {
		readonly memory: number;
		readonly iterations: number;
		readonly parallelism: number;
		readonly saltBase64: string;
	};
}

export interface ShareFileMetadata {
	readonly signerName: string;
	readonly participantIndex: 1 | 2 | 3;
	readonly scheme: SchemeName;
	readonly curve: CurveName;
	readonly ethAddress: string;
	readonly chain: ChainName;
	readonly network?: NetworkName;
	readonly createdAt: string;
}

export interface ShareFile {
	readonly version: number;
	readonly encryption: ShareFileEncryption;
	readonly ciphertextBase64: string;
	readonly metadata: ShareFileMetadata;
}
