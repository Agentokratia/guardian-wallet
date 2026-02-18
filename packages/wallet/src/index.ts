#!/usr/bin/env node

const args = process.argv.slice(2);

if (args.length > 0) {
	const { runCli } = await import('./cli/index.js');
	await runCli();
} else {
	const { runMcp } = await import('./mcp/index.js');
	await runMcp();
}
