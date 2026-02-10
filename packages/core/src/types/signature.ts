import type { SchemeName } from '../enums/scheme-name.js';

export interface Signature {
	readonly r: Uint8Array;
	readonly s: Uint8Array;
	readonly v?: number;
	readonly scheme: SchemeName;
}
