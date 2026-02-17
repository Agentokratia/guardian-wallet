export interface IShareStore {
	storeShare(path: string, share: Uint8Array): Promise<void>;
	getShare(path: string): Promise<Uint8Array>;
	deleteShare(path: string): Promise<void>;
	healthCheck(): Promise<boolean>;
}

/** @deprecated Use IShareStore instead. */
export type IVaultStore = IShareStore;
