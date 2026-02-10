import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

/**
 * Prompt the user for hidden input (e.g. API key, API secret).
 * Characters typed are not echoed to the terminal.
 */
export async function promptHidden(question: string): Promise<string> {
	return new Promise((resolve) => {
		const rl = createInterface({ input: stdin, output: stdout });
		stdout.write(question);

		// Store the original write and suppress echoed characters
		const originalWrite = stdout.write.bind(stdout) as typeof stdout.write;
		let muted = true;

		const mutedWrite = function (
			this: typeof stdout,
			...args: Parameters<typeof stdout.write>
		): boolean {
			const chunk = args[0];
			if (muted && typeof chunk === 'string' && !chunk.includes('\n')) {
				return true;
			}
			return originalWrite(...args);
		} as typeof stdout.write;

		stdout.write = mutedWrite;

		rl.question('')
			.then((answer) => {
				muted = false;
				stdout.write = originalWrite;
				stdout.write('\n');
				rl.close();
				resolve(answer);
			})
			.catch(() => {
				muted = false;
				stdout.write = originalWrite;
				rl.close();
				resolve('');
			});
	});
}
