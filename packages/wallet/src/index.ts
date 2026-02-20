#!/usr/bin/env node

import { isatty } from 'node:tty';

const args = process.argv.slice(2);

if (args.length > 0) {
	// CLI mode: gw <command> [options]
	const { runCli } = await import('./cli/index.js');
	await runCli();
} else if (isatty(0)) {
	// Interactive terminal with no args → show help instead of silent MCP
	process.argv.push('--help');
	const { runCli } = await import('./cli/index.js');
	await runCli();
} else {
	// Piped / non-interactive → MCP server (for AI agents)
	const { runMcp } = await import('./mcp/index.js');
	await runMcp();
}
