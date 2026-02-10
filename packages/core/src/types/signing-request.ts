import type { RequestStatus } from '../enums/request-status.js';
import type { RequestType } from '../enums/request-type.js';
import type { SigningPath } from '../enums/signing-path.js';
import type { PolicyViolation } from '../interfaces/policy-engine.interface.js';

export interface SigningRequest {
	readonly id: string;
	readonly signerId: string;
	readonly requestType: RequestType;
	readonly signingPath: SigningPath;
	readonly status: RequestStatus;
	readonly toAddress?: string;
	readonly valueWei: string;
	readonly chainId: number;
	readonly txData?: string;
	readonly decodedAction?: string;
	readonly txHash?: string;
	readonly nonce?: number;
	readonly policyViolations?: readonly PolicyViolation[];
	readonly policiesEvaluated: number;
	readonly evaluationTimeMs: number;
	readonly createdAt: string;
}
