import { type CertificationScore, calculateCertification } from '@/lib/certification-score';
import { useMemo } from 'react';
import { useAuditLog } from './use-audit-log';
import { usePolicy } from './use-policies';
import { useSigner } from './use-signer';

export function useCertification(signerId: string): CertificationScore | null {
	const { data: signer } = useSigner(signerId);
	const { data: policy } = usePolicy(signerId);
	const { data: requests } = useAuditLog({ signerId, limit: 500 });

	return useMemo(() => {
		if (!signer) return null;
		return calculateCertification(signer, policy ?? null, requests ?? []);
	}, [signer, policy, requests]);
}
