import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';

export function promptHidden(question: string): Promise<string> {
	return new Promise((resolve) => {
		const rl = createInterface({ input: stdin, output: stdout });

		// Mute output so typed characters aren't echoed
		(rl as unknown as { output: NodeJS.WritableStream }).output.write(question);
		stdin.setRawMode?.(true);

		let input = '';

		const onData = (char: Buffer) => {
			const c = char.toString('utf8');

			if (c === '\n' || c === '\r' || c === '\u0004') {
				stdin.setRawMode?.(false);
				stdin.removeListener('data', onData);
				stdout.write('\n');
				rl.close();
				resolve(input);
			} else if (c === '\u0003') {
				// Ctrl+C
				stdin.setRawMode?.(false);
				stdin.removeListener('data', onData);
				rl.close();
				process.exit(130);
			} else if (c === '\u007f' || c === '\b') {
				// Backspace
				input = input.slice(0, -1);
			} else {
				input += c;
			}
		};

		stdin.on('data', onData);
	});
}
