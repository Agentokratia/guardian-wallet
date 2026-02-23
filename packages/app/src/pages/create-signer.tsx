import { CreatingPhase } from '@/components/create-signer/creating-phase';
import { DonePhase } from '@/components/create-signer/done-phase';
import { EncryptPhase } from '@/components/create-signer/encrypt-phase';
import { ErrorPhase } from '@/components/create-signer/error-phase';
import { InputPhase } from '@/components/create-signer/input-phase';
import type { CreationResult, DKGResult, Phase } from '@/components/create-signer/types';
import { Header } from '@/components/layout/header';
import { useAuth } from '@/hooks/use-auth';
import { useCreateSigner, useDKGFinalize, useDKGInit } from '@/hooks/use-dkg';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api-client';
import { downloadFile } from '@/lib/download';
import { encryptUserShare } from '@/lib/user-share-store';
import { cn } from '@/lib/utils';
import { wipePRF } from '@agentokratia/guardian-auth/browser';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/* -------------------------------------------------------------------------- */
/*  Progress bar                                                               */
/* -------------------------------------------------------------------------- */

const STEPS = ['Account', 'Backup', 'Credentials'] as const;

function phaseToStep(phase: Phase): number {
	if (phase === 'input') return 0;
	if (phase === 'creating') return 0;
	if (phase === 'encrypt') return 1;
	if (phase === 'done') return 2;
	return 0;
}

function ProgressBar({ phase }: { phase: Phase }) {
	const step = phaseToStep(phase);
	if (phase === 'error') return null;

	const pct = step === 0 ? (phase === 'creating' ? 25 : 5) : step === 1 ? 55 : 100;

	return (
		<div className="mx-auto mb-8 max-w-md">
			{/* Labels */}
			<div className="mb-2 flex justify-between">
				{STEPS.map((label, i) => (
					<span
						key={label}
						className={cn(
							'text-[11px] font-medium transition-colors',
							i <= step ? 'text-text' : 'text-text-dim',
						)}
						aria-current={i === step ? 'step' : undefined}
					>
						{label}
					</span>
				))}
			</div>
			{/* Bar */}
			<div className="h-1 w-full overflow-hidden rounded-full bg-border">
				<div
					className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
					style={{ width: `${pct}%` }}
				/>
			</div>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */

export function CreateSignerPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { isAuthenticated, address, refreshPRF } = useAuth();

	// Destructure stable mutateAsync refs (TanStack Query v5 guarantees stability)
	const { mutateAsync: createSignerAsync } = useCreateSigner();
	const { mutateAsync: dkgInitAsync } = useDKGInit();
	const { mutateAsync: dkgFinalizeAsync } = useDKGFinalize();

	// Input state
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [accountType, setAccountType] = useState('ai_agent');

	// Flow state
	const [phase, setPhase] = useState<Phase>('input');
	const [creationStep, setCreationStep] = useState(0);
	const [dkgResult, setDkgResult] = useState<DKGResult | null>(null);
	const [result, setResult] = useState<CreationResult | null>(null);
	const [errorMessage, setErrorMessage] = useState('');
	const [secretDownloaded, setSecretDownloaded] = useState(false);

	// Prevent leaving without downloading
	const needsDownloadRef = useRef(false);

	// Focus management — focus phase container on transition
	const phaseRef = useRef<HTMLDivElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional focus on phase transition
	useEffect(() => {
		phaseRef.current?.focus({ preventScroll: true });
	}, [phase]);

	useEffect(() => {
		const handler = (e: BeforeUnloadEvent) => {
			if (needsDownloadRef.current) {
				e.preventDefault();
			}
		};
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	}, []);

	/* -------------------------------------------------------------------- */
	/*  Transition to done                                                    */
	/* -------------------------------------------------------------------- */

	const finalizeToDone = useCallback(
		(dkg: DKGResult, backupStored: boolean, backupPayload: string) => {
			setResult({
				signerId: dkg.signerId,
				ethAddress: dkg.ethAddress,
				apiKey: dkg.apiKey,
				shareData: dkg.shareData,
				backupStored,
				backupPayload,
			});
			needsDownloadRef.current = true;
			setPhase('done');
		},
		[],
	);

	/* -------------------------------------------------------------------- */
	/*  Step 1: Create signer + DKG                                          */
	/* -------------------------------------------------------------------- */

	const handleCreate = useCallback(async () => {
		if (!name.trim()) return;

		setPhase('creating');
		setCreationStep(0);
		setErrorMessage('');

		try {
			// 1. Create signer record
			const { signer, apiKey } = await createSignerAsync({
				name: name.trim(),
				type: accountType,
				scheme: 'cggmp24',
				description: description.trim() || undefined,
			});
			setCreationStep(1);

			// 2. DKG — generate keys
			const initResult = await dkgInitAsync({ signerId: signer.id });
			setCreationStep(2);

			const finalResult = await dkgFinalizeAsync({
				sessionId: initResult.sessionId,
				signerId: signer.id,
			});

			// 3. Store intermediate result → move to encrypt phase
			const intermediate: DKGResult = {
				signerId: signer.id,
				ethAddress: finalResult.ethAddress,
				apiKey,
				shareData: finalResult.signerShare,
				userShare: finalResult.userShare,
			};
			setDkgResult(intermediate);

			if (finalResult.userShare && isAuthenticated) {
				setPhase('encrypt');
			} else {
				finalizeToDone(intermediate, false, '');
			}
		} catch (err: unknown) {
			setPhase('error');
			setErrorMessage(err instanceof Error ? err.message : 'Account creation failed');
		}
	}, [
		name,
		description,
		accountType,
		createSignerAsync,
		dkgInitAsync,
		dkgFinalizeAsync,
		isAuthenticated,
		finalizeToDone,
	]);

	/* -------------------------------------------------------------------- */
	/*  Step 2: Passkey encryption                                           */
	/* -------------------------------------------------------------------- */

	const handleEncrypt = useCallback(async () => {
		if (!dkgResult) throw new Error('No DKG result');

		console.log('[create-signer] Getting PRF for share encryption...');
		const prfOutput = await refreshPRF();
		console.log('[create-signer] Got PRF, length:', prfOutput.length);

		try {
			const shareBytes = Uint8Array.from(atob(dkgResult.userShare), (c) => c.charCodeAt(0));
			const encrypted = await encryptUserShare(shareBytes, prfOutput);

			const payload = {
				walletAddress: address,
				iv: encrypted.iv,
				ciphertext: encrypted.ciphertext,
				salt: encrypted.salt,
			};
			await api.post(`/signers/${dkgResult.signerId}/user-share`, payload);
			console.log('[create-signer] User share encrypted and stored successfully');

			finalizeToDone(dkgResult, true, JSON.stringify(payload));
		} finally {
			wipePRF(prfOutput);
		}
	}, [dkgResult, refreshPRF, address, finalizeToDone]);

	const handleSkipEncrypt = useCallback(() => {
		if (!dkgResult) return;
		finalizeToDone(dkgResult, false, '');
	}, [dkgResult, finalizeToDone]);

	/* -------------------------------------------------------------------- */
	/*  Done phase handlers                                                   */
	/* -------------------------------------------------------------------- */

	const handleDownloadSecret = useCallback(() => {
		if (!result?.shareData) return;
		const blob = new Blob([result.shareData], { type: 'text/plain' });
		downloadFile(blob, `${name || 'signer'}.secret`);
		setSecretDownloaded(true);
		needsDownloadRef.current = false;
	}, [result, name]);

	const finishCreation = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: ['signers'] });
		toast({ title: 'Account created', description: `${name} is ready to use.` });
	}, [queryClient, toast, name]);

	const handleGuardrails = useCallback(() => {
		finishCreation();
		navigate(`/signers/${result?.signerId}/guardrails`);
	}, [finishCreation, navigate, result?.signerId]);

	const handleSkip = useCallback(() => {
		finishCreation();
		navigate(`/signers/${result?.signerId}`);
	}, [finishCreation, navigate, result?.signerId]);

	const handleRetry = useCallback(() => setPhase('input'), []);

	/* -------------------------------------------------------------------- */
	/*  Render                                                                */
	/* -------------------------------------------------------------------- */

	return (
		<main>
			<Header title="Create Account" backHref="/signers" backLabel="Back to Accounts" />

			<ProgressBar phase={phase} />

			<div
				ref={phaseRef}
				tabIndex={-1}
				className={cn('mx-auto outline-none', phase === 'done' ? 'max-w-3xl' : 'max-w-lg')}
			>
				{phase === 'input' && (
					<InputPhase
						name={name}
						description={description}
						accountType={accountType}
						isAuthenticated={isAuthenticated}
						onNameChange={setName}
						onDescriptionChange={setDescription}
						onAccountTypeChange={setAccountType}
						onCreate={handleCreate}
					/>
				)}

				{phase === 'creating' && <CreatingPhase step={creationStep} />}

				{phase === 'encrypt' && (
					<EncryptPhase onEncrypt={handleEncrypt} onSkip={handleSkipEncrypt} />
				)}

				{phase === 'error' && <ErrorPhase errorMessage={errorMessage} onRetry={handleRetry} />}

				{phase === 'done' && result && (
					<DonePhase
						name={name}
						result={result}
						secretDownloaded={secretDownloaded}
						onDownloadSecret={handleDownloadSecret}
						onGuardrails={handleGuardrails}
						onSkip={handleSkip}
					/>
				)}
			</div>
		</main>
	);
}
