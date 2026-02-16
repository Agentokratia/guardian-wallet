import { useEffect, useRef, useState } from 'react';

/**
 * Animates a number from 0 to `target` over `duration` ms.
 * Returns the current interpolated value as a string with `decimals` places.
 */
export function useAnimatedCounter(
	target: number,
	duration = 600,
	decimals = 2,
): string {
	const [current, setCurrent] = useState(0);
	const prevTarget = useRef(0);
	const raf = useRef<number>();

	useEffect(() => {
		if (Number.isNaN(target)) return;

		const from = prevTarget.current;
		const diff = target - from;
		if (diff === 0) return;

		const start = performance.now();

		function tick(now: number) {
			const elapsed = now - start;
			const progress = Math.min(elapsed / duration, 1);
			// ease-out cubic
			const eased = 1 - (1 - progress) ** 3;
			setCurrent(from + diff * eased);

			if (progress < 1) {
				raf.current = requestAnimationFrame(tick);
			} else {
				prevTarget.current = target;
			}
		}

		raf.current = requestAnimationFrame(tick);
		return () => {
			if (raf.current) cancelAnimationFrame(raf.current);
		};
	}, [target, duration]);

	return current.toFixed(decimals);
}
