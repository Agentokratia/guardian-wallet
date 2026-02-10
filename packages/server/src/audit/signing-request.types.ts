import type { PolicyViolation, RequestStatus, RequestType, SigningPath } from '@agentokratia/guardian-core';

export interface SigningRequestEntity {
	readonly id: string;
	readonly signerId: string;
	readonly requestType: RequestType;
	readonly signingPath: SigningPath;
	readonly status: RequestStatus;
	readonly toAddress: string | null;
	readonly valueWei: string | null;
	readonly chainId: number | null;
	readonly txData: string | null;
	readonly decodedAction: string | null;
	readonly txHash: string | null;
	readonly nonce: number | null;
	readonly policyViolations: readonly PolicyViolation[];
	readonly policiesEvaluated: number;
	readonly evaluationTimeMs: number | null;
	readonly createdAt: Date;
}

export interface SigningRequestRow {
	id: string;
	signer_id: string;
	request_type: string;
	signing_path: string;
	status: string;
	to_address: string | null;
	value_wei: string | null;
	chain_id: number | null;
	tx_data: string | null;
	decoded_action: string | null;
	tx_hash: string | null;
	nonce: number | null;
	policy_violations: Record<string, unknown>[] | null;
	policies_evaluated: number;
	evaluation_time_ms: number | null;
	created_at: string;
}

export interface PaginationParams {
	readonly page: number;
	readonly limit: number;
}

export interface PaginatedResult<T> {
	readonly data: readonly T[];
	readonly total: number;
	readonly page: number;
	readonly limit: number;
}

export interface AuditLogFilters {
	readonly signerId?: string;
	readonly status?: RequestStatus;
	readonly requestType?: string;
	readonly from?: Date;
	readonly to?: Date;
	ownerAddress?: string;
}

export interface CreateSigningRequestDto {
	readonly signerId: string;
	readonly requestType: string;
	readonly signingPath: string;
	readonly status: string;
	readonly toAddress?: string;
	readonly valueWei?: string;
	readonly chainId?: number;
	readonly txData?: string;
	readonly decodedAction?: string;
	readonly txHash?: string;
	readonly nonce?: number;
	readonly policyViolations?: readonly Record<string, unknown>[];
	readonly policiesEvaluated?: number;
	readonly evaluationTimeMs?: number;
	readonly ownerAddress?: string;
}
