/**
 * Signing benchmark — n=30 runs with statistical analysis for the research paper.
 *
 * Usage: npx tsx packages/cli/src/bench-sign.ts [runs=30]
 */
import { performance } from 'node:perf_hooks';
import { CGGMP24Scheme } from '@agentokratia/guardian-schemes';
import { ThresholdSigner } from '@agentokratia/guardian-signer';
import { loadConfig, resolveApiSecret } from './config.js';

const RUNS = Number(process.argv[2]) || 30;

function stats(arr: number[]) {
	const sorted = [...arr].sort((a, b) => a - b);
	const n = sorted.length;
	const mean = arr.reduce((a, b) => a + b, 0) / n;
	const variance = arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (n - 1);
	const stddev = Math.sqrt(variance);
	const median = n % 2 ? sorted[Math.floor(n / 2)]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
	const p5 = sorted[Math.floor(n * 0.05)]!;
	const p95 = sorted[Math.floor(n * 0.95)]!;
	const ci95 = 1.96 * stddev / Math.sqrt(n); // 95% confidence interval
	return { mean, median, stddev, min: sorted[0]!, max: sorted[n - 1]!, p5, p95, ci95 };
}

async function main() {
	const config = loadConfig();
	const apiSecret = resolveApiSecret(config);

	console.log(`\n  Signing Benchmark — ${RUNS} runs\n  ${'─'.repeat(50)}\n`);
	console.log(`  Server: ${config.serverUrl}`);
	console.log(`  Network: ${config.network}\n`);

	const timings: number[] = [];

	for (let i = 0; i < RUNS; i++) {
		const scheme = new CGGMP24Scheme();
		await scheme.initWasm();

		const signer = await ThresholdSigner.fromSecret({
			apiSecret,
			serverUrl: config.serverUrl,
			apiKey: config.apiKey,
			scheme,
		});

		const t0 = performance.now();
		await signer.signMessage('bench ' + Date.now() + ' ' + i);
		const elapsed = performance.now() - t0;

		timings.push(elapsed);
		signer.destroy();

		if ((i + 1) % 10 === 0 || i === 0) {
			console.log(`  Run ${i + 1}/${RUNS}: ${elapsed.toFixed(0)} ms`);
		}
	}

	const s = stats(timings);

	console.log(`\n  Results (n=${RUNS})\n  ${'─'.repeat(50)}`);
	console.log(`  Mean:     ${s.mean.toFixed(0)} ms`);
	console.log(`  Median:   ${s.median.toFixed(0)} ms`);
	console.log(`  Std dev:  ${s.stddev.toFixed(0)} ms`);
	console.log(`  95% CI:   ±${s.ci95.toFixed(0)} ms  (${(s.mean - s.ci95).toFixed(0)}–${(s.mean + s.ci95).toFixed(0)} ms)`);
	console.log(`  Min:      ${s.min.toFixed(0)} ms`);
	console.log(`  Max:      ${s.max.toFixed(0)} ms`);
	console.log(`  P5:       ${s.p5.toFixed(0)} ms`);
	console.log(`  P95:      ${s.p95.toFixed(0)} ms`);
	console.log('');

	// LaTeX-ready output
	console.log(`  LaTeX: median=${s.median.toFixed(0)}ms, mean=${s.mean.toFixed(0)}±${s.ci95.toFixed(0)}ms, P5/P95=${s.p5.toFixed(0)}/${s.p95.toFixed(0)}ms, range=${s.min.toFixed(0)}–${s.max.toFixed(0)}ms`);
	console.log('');
}

main().catch(err => {
	console.error('Benchmark failed:', err);
	process.exit(1);
});
