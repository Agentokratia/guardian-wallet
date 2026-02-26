import { CreatingPhase } from '@/components/create-signer/creating-phase';
import { DonePhase } from '@/components/create-signer/done-phase';
import { ErrorPhase } from '@/components/create-signer/error-phase';
import { InputPhase } from '@/components/create-signer/input-phase';
import type { CreationResult, DKGResult, Phase } from '@/components/create-signer/types';
import { Header } from '@/components/layout/header';
import { useAuth } from '@/hooks/use-auth';
import { useCreateSigner } from '@/hooks/use-dkg';
import { useToast } from '@/hooks/use-toast';
import { ApiError, api } from '@/lib/api-client';
import { encryptUserShare } from '@/lib/user-share-store';
import { cn } from '@/lib/utils';
import { wipePRF } from '@agentokratia/guardian-auth/browser';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/* -------------------------------------------------------------------------- */
/*  Progress bar                                                               */
/* -------------------------------------------------------------------------- */

const STEPS = ['Account', 'Credentials'] as const;

function phaseToStep(phase: Phase): number {
	if (phase === 'input' || phase === 'creating') return 0;
	if (phase === 'done') return 1;
	return 0;
}

function ProgressBar({ phase }: { phase: Phase }) {
	const step = phaseToStep(phase);
	if (phase === 'error') return null;

	const pct = step === 0 ? (phase === 'creating' ? 40 : 5) : 100;

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
	const { isAuthenticated, address, hasPasskey, setupPasskey, refreshPRF } = useAuth();

	// Destructure stable mutateAsync refs (TanStack Query v5 guarantees stability)
	const { mutateAsync: createSignerAsync } = useCreateSigner();

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
	const [errorStatus, setErrorStatus] = useState<number | null>(null);
	const [encryptError, setEncryptError] = useState('');

	// Focus management — focus phase container on transition
	const phaseRef = useRef<HTMLDivElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional focus on phase transition
	useEffect(() => {
		phaseRef.current?.focus({ preventScroll: true });
	}, [phase]);

	/* -------------------------------------------------------------------- */
	/*  Transition to done                                                    */
	/* -------------------------------------------------------------------- */

	const finalizeToDone = useCallback(
		(dkg: DKGResult, backupStored: boolean, backupPayload: string) => {
			setResult({
				signerId: dkg.signerId,
				ethAddress: dkg.ethAddress,
				apiKey: dkg.apiKey,
				apiSecret: dkg.apiSecret,
				backupStored,
				backupPayload,
			});
			setPhase('done');
		},
		[],
	);

	/* -------------------------------------------------------------------- */
	/*  Passkey encrypt — shared logic for create + retry                     */
	/* -------------------------------------------------------------------- */

	const doEncrypt = useCallback(
		async (dkg: DKGResult): Promise<string> => {
			let prfOutput: Uint8Array | null = null;

			if (!hasPasskey) {
				if (import.meta.env.DEV) console.log('[create-signer] No passkey — initiating setup');
				prfOutput = await setupPasskey();
			}

			if (!prfOutput) {
				prfOutput = await refreshPRF();
			}

			try {
				const shareBytes = Uint8Array.from(atob(dkg.userShare), (c) => c.charCodeAt(0));
				const encrypted = await encryptUserShare(shareBytes, prfOutput);

				const payload = {
					walletAddress: address,
					iv: encrypted.iv,
					ciphertext: encrypted.ciphertext,
					salt: encrypted.salt,
				};
				await api.post(`/signers/${dkg.signerId}/user-share`, payload);

				return JSON.stringify(payload);
			} finally {
				wipePRF(prfOutput);
			}
		},
		[hasPasskey, setupPasskey, refreshPRF, address],
	);

	/* -------------------------------------------------------------------- */
	/*  Step 1: Create signer + DKG + auto-encrypt                           */
	/* -------------------------------------------------------------------- */

	const handleCreate = useCallback(async () => {
		if (!name.trim()) return;

		setPhase('creating');
		setCreationStep(0);
		setErrorMessage('');
		setErrorStatus(null);
		setEncryptError('');

		try {
			// Server does create + DKG in one call (createWithDKG)
			const result = await createSignerAsync({
				name: name.trim(),
				type: accountType,
				scheme: 'cggmp24',
				description: description.trim() || undefined,
			});

			const intermediate: DKGResult = {
				signerId: result.signerId,
				ethAddress: result.ethAddress,
				apiKey: result.apiKey,
				apiSecret: result.signerShare,
				userShare: result.userShare,
			};
			setDkgResult(intermediate);

			// Auto-fire passkey encrypt as final creation step
			setCreationStep(2);
			try {
				const payload = await doEncrypt(intermediate);
				finalizeToDone(intermediate, true, payload);
			} catch {
				setEncryptError('Passkey was cancelled or failed.');
			}
		} catch (err: unknown) {
			setPhase('error');
			setErrorStatus(err instanceof ApiError ? err.status : null);
			setErrorMessage(err instanceof Error ? err.message : 'Account creation failed');
		}
	}, [name, description, accountType, createSignerAsync, doEncrypt, finalizeToDone]);

	/* -------------------------------------------------------------------- */
	/*  Encrypt retry / skip (from CreatingPhase error state)                 */
	/* -------------------------------------------------------------------- */

	const handleRetryEncrypt = useCallback(async () => {
		if (!dkgResult) return;
		setEncryptError('');

		try {
			const payload = await doEncrypt(dkgResult);
			finalizeToDone(dkgResult, true, payload);
		} catch {
			setEncryptError('Passkey was cancelled or failed. Try again or skip.');
		}
	}, [dkgResult, doEncrypt, finalizeToDone]);

	/* -------------------------------------------------------------------- */
	/*  Done phase handlers                                                   */
	/* -------------------------------------------------------------------- */

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

				{phase === 'creating' && (
					<CreatingPhase
						step={creationStep}
						encryptError={encryptError}
						onRetryEncrypt={handleRetryEncrypt}
					/>
				)}

				{phase === 'error' && (
					<ErrorPhase errorMessage={errorMessage} errorStatus={errorStatus} onRetry={handleRetry} />
				)}

				{phase === 'done' && result && (
					<DonePhase
						name={name}
						result={result}
						onGuardrails={handleGuardrails}
						onSkip={handleSkip}
					/>
				)}
			</div>
		</main>
	);
}
