import { cn } from '@/lib/utils';
import { useCallback, useEffect, useRef, useState } from 'react';

interface OTPInputProps {
	length?: number;
	value: string;
	onChange: (value: string) => void;
	onComplete?: (code: string) => void;
	disabled?: boolean;
	className?: string;
}

export function OTPInput({
	length = 6,
	value,
	onChange,
	onComplete,
	disabled = false,
	className,
}: OTPInputProps) {
	const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
	const onCompleteRef = useRef(onComplete);
	onCompleteRef.current = onComplete;
	const [submitted, setSubmitted] = useState(false);

	const focusInput = useCallback((index: number) => {
		const input = inputsRef.current[index];
		if (input) {
			input.focus();
			input.select();
		}
	}, []);

	// Reset submitted flag when value changes (e.g. user clears and retypes)
	useEffect(() => {
		if (value.length < length) {
			setSubmitted(false);
		}
	}, [value, length]);

	// Auto-submit when all digits filled — fires exactly once
	useEffect(() => {
		if (value.length === length && !submitted && onCompleteRef.current) {
			setSubmitted(true);
			onCompleteRef.current(value);
		}
	}, [value, length, submitted]);

	const handleChange = useCallback(
		(index: number, digit: string) => {
			if (!/^\d?$/.test(digit)) return;

			const chars = value.split('');
			// Pad to current index if needed
			while (chars.length <= index) chars.push('');
			chars[index] = digit;

			const newValue = chars.join('').slice(0, length);
			onChange(newValue);

			// Move focus to next input
			if (digit && index < length - 1) {
				focusInput(index + 1);
			}
		},
		[value, length, onChange, focusInput],
	);

	const handleKeyDown = useCallback(
		(index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === 'Backspace') {
				e.preventDefault();
				const chars = value.split('');
				if (chars[index]) {
					chars[index] = '';
					onChange(chars.join(''));
				} else if (index > 0) {
					chars[index - 1] = '';
					onChange(chars.join(''));
					focusInput(index - 1);
				}
			} else if (e.key === 'ArrowLeft' && index > 0) {
				focusInput(index - 1);
			} else if (e.key === 'ArrowRight' && index < length - 1) {
				focusInput(index + 1);
			}
		},
		[value, length, onChange, focusInput],
	);

	const handlePaste = useCallback(
		(e: React.ClipboardEvent) => {
			e.preventDefault();
			const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
			if (pasted) {
				onChange(pasted);
				focusInput(Math.min(pasted.length, length - 1));
			}
		},
		[length, onChange, focusInput],
	);

	return (
		<div className={cn('flex items-center gap-2 justify-center', className)}>
			{Array.from({ length }, (_, i) => (
				<input
					key={i}
					ref={(el) => {
						inputsRef.current[i] = el;
					}}
					type="text"
					inputMode="numeric"
					pattern="\d"
					maxLength={1}
					value={value[i] ?? ''}
					onChange={(e) => handleChange(i, e.target.value)}
					onKeyDown={(e) => handleKeyDown(i, e)}
					onPaste={handlePaste}
					onFocus={(e) => e.target.select()}
					disabled={disabled}
					className={cn(
						'h-12 w-10 rounded-lg border bg-surface text-center font-mono text-lg font-bold text-text',
						'transition-all duration-150',
						'focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none',
						'disabled:opacity-50 disabled:cursor-not-allowed',
						value[i] ? 'border-accent/50' : 'border-border',
					)}
					aria-label={`Digit ${i + 1}`}
				/>
			))}
		</div>
	);
}
