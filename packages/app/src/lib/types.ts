export interface Signer {
	id: string;
	name: string;
	description?: string;
	type: string;
	ethAddress: string;
	chain: string;
	scheme: string;
	network?: string;
	status: 'active' | 'paused' | 'revoked';
	dkgCompleted: boolean;
	createdAt: string;
	updatedAt: string;
	lastActiveAt?: string;
	revokedAt?: string;
}

export interface Policy {
	id: string;
	signerId: string;
	type: string;
	config: Record<string, unknown>;
	enabled: boolean;
	appliesTo: string[];
	timesTriggered: number;
	createdAt: string;
	updatedAt: string;
}

export interface PolicyDocumentResponse {
	id?: string;
	signerId?: string;
	description?: string | null;
	rules: Record<string, unknown>[];
	version?: number;
	createdAt?: string;
	updatedAt?: string;
}

export interface PolicyViolationSummary {
	type: string;
	reason: string;
}

export interface SigningRequest {
	id: string;
	signerId: string;
	requestType: string;
	signingPath: string;
	status: string;
	toAddress?: string;
	valueWei?: string;
	chainId?: number;
	txData?: string;
	decodedAction?: string;
	txHash?: string;
	nonce?: number;
	policyViolations?: PolicyViolationSummary[];
	policiesEvaluated?: number;
	evaluationTimeMs?: number;
	createdAt: string;
}
