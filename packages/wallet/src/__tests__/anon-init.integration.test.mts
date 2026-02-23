/**
 * End-to-end test of the anonymous signer init flow.
 * Simulates exactly what `gw init` option 1 does:
 *
 * 1. POST /signers/public → creates signer + DKG
 * 2. Save signer config to ~/.guardian-wallet/signers/<name>.json
 * 3. Store user share (file fallback since no keytar)
 * 4. Compute hash(userShare) → save admin token
 * 5. Set as default signer
 * 6. Verify: load config, check admin auth works
 *
 * Requires: server running on localhost:8080
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = join(homedir(), '.guardian-wallet');
const TEST_NAME = `test-anon-${Date.now()}`;
const SERVER = 'http://localhost:8080';

async function main() {
	console.log(`\n  Testing anonymous init flow for signer "${TEST_NAME}"\n`);

	// =========================================================================
	// Step 1: POST /signers/public (same as init.command.ts handleCreate)
	// =========================================================================
	console.log('  Step 1: Creating signer via POST /signers/public...');
	const createRes = await fetch(`${SERVER}/api/v1/signers/public`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: TEST_NAME, network: 'base-sepolia' }),
		signal: AbortSignal.timeout(120_000),
	});

	if (!createRes.ok) {
		const text = await createRes.text();
		throw new Error(`Create failed: ${createRes.status} ${text}`);
	}

	const result = await createRes.json() as {
		signerId: string;
		ethAddress: string;
		apiKey: string;
		signerShare: string;
		userShare: string;
	};

	console.log(`    signerId:  ${result.signerId}`);
	console.log(`    address:   ${result.ethAddress}`);
	console.log(`    apiKey:    ${result.apiKey.slice(0, 20)}...`);
	console.log(`    shares:    signer=${result.signerShare.length} chars, user=${result.userShare.length} chars`);
	assert(result.signerId, 'signerId missing');
	assert(result.ethAddress.startsWith('0x'), 'ethAddress missing');
	assert(result.apiKey.startsWith('gw_live_'), 'apiKey missing prefix');
	assert(result.signerShare.length > 100, 'signerShare too short');
	assert(result.userShare.length > 100, 'userShare too short');
	console.log('    PASS\n');

	// =========================================================================
	// Step 2: Save signer config (same as init.command.ts)
	// =========================================================================
	console.log('  Step 2: Saving signer config...');
	const signersDir = join(CONFIG_DIR, 'signers');
	if (!existsSync(signersDir)) mkdirSync(signersDir, { recursive: true, mode: 0o700 });

	const config = {
		version: 1,
		serverUrl: SERVER,
		apiKey: result.apiKey,
		apiSecret: result.signerShare,
		network: 'base-sepolia',
		signerName: TEST_NAME,
		ethAddress: result.ethAddress,
		signerId: result.signerId,
		createdAt: new Date().toISOString(),
	};

	const configPath = join(signersDir, `${TEST_NAME}.json`);
	const { writeFileSync, renameSync } = await import('node:fs');
	const tmpPath = `${configPath}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(config, null, '\t'), { mode: 0o600 });
	renameSync(tmpPath, configPath);
	console.log(`    Written to: ${configPath}`);
	assert(existsSync(configPath), 'Config file not created');
	console.log('    PASS\n');

	// =========================================================================
	// Step 3: Store user share (file fallback)
	// =========================================================================
	console.log('  Step 3: Storing user share (file fallback)...');
	const userSharePath = join(signersDir, `${TEST_NAME}.user-share`);
	const usTmp = `${userSharePath}.tmp`;
	writeFileSync(usTmp, result.userShare, { mode: 0o600 });
	renameSync(usTmp, userSharePath);
	console.log(`    Written to: ${userSharePath}`);
	const stored = readFileSync(userSharePath, 'utf-8').trim();
	assert(stored === result.userShare, 'User share mismatch');
	console.log('    PASS\n');

	// =========================================================================
	// Step 4: Save admin token — hash(userShare)
	// =========================================================================
	console.log('  Step 4: Saving admin token...');
	const adminDir = join(CONFIG_DIR, 'admin');
	if (!existsSync(adminDir)) mkdirSync(adminDir, { recursive: true, mode: 0o700 });

	const hash = createHash('sha256').update(result.userShare).digest('hex');
	const adminToken = {
		hash,
		createdAt: new Date().toISOString(),
		expiresAt: null,
	};
	const adminPath = join(adminDir, `${TEST_NAME}.token`);
	const atTmp = `${adminPath}.tmp`;
	writeFileSync(atTmp, JSON.stringify(adminToken, null, '\t'), { mode: 0o600 });
	renameSync(atTmp, adminPath);
	console.log(`    hash(userShare): ${hash.slice(0, 20)}...`);
	console.log(`    Written to: ${adminPath}`);
	assert(existsSync(adminPath), 'Admin token file not created');
	console.log('    PASS\n');

	// =========================================================================
	// Step 5: Set as default
	// =========================================================================
	console.log('  Step 5: Setting as default signer...');
	writeFileSync(join(CONFIG_DIR, '.default'), `${TEST_NAME}\n`, { mode: 0o600 });
	const defaultName = readFileSync(join(CONFIG_DIR, '.default'), 'utf-8').trim();
	assert(defaultName === TEST_NAME, 'Default signer mismatch');
	console.log('    PASS\n');

	// =========================================================================
	// Step 6: Verify — load config back and test API key auth
	// =========================================================================
	console.log('  Step 6: Verify — API key auth (GET /signers)...');
	const loadedConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
	const listRes = await fetch(`${SERVER}/api/v1/signers`, {
		headers: { 'x-api-key': loadedConfig.apiKey },
	});
	assert(listRes.status === 200, `Expected 200, got ${listRes.status}`);
	const signers = await listRes.json() as { name: string; ethAddress: string; status: string }[];
	assert(signers.length > 0, 'No signers returned');
	assert(signers[0]!.ethAddress === result.ethAddress, 'Address mismatch');
	console.log(`    Signer: ${signers[0]!.name} (${signers[0]!.ethAddress.slice(0, 6)}...)`);
	console.log('    PASS\n');

	// =========================================================================
	// Step 7: Verify — admin auth with raw hash (pause signer)
	// =========================================================================
	console.log('  Step 7: Verify — admin auth raw hash (POST /signers/:id/pause)...');
	const pauseRes = await fetch(`${SERVER}/api/v1/signers/${result.signerId}/pause`, {
		method: 'POST',
		headers: {
			'X-Admin-Token': hash,
		},
	});
	const pauseBody = await pauseRes.json() as { status: string };
	console.log(`    Status: ${pauseRes.status}, signer: ${pauseBody.status}`);
	assert(pauseRes.status === 200 || pauseRes.status === 201, `Expected 200/201, got ${pauseRes.status}`);
	assert(pauseBody.status === 'paused', `Expected paused, got ${pauseBody.status}`);
	console.log('    PASS\n');

	// =========================================================================
	// Step 8: Verify — resume via admin auth
	// =========================================================================
	console.log('  Step 8: Verify — admin auth raw hash (POST /signers/:id/resume)...');
	const resumeRes = await fetch(`${SERVER}/api/v1/signers/${result.signerId}/resume`, {
		method: 'POST',
		headers: {
			'X-Admin-Token': hash,
		},
	});
	const resumeBody = await resumeRes.json() as { status: string };
	console.log(`    Status: ${resumeRes.status}, signer: ${resumeBody.status}`);
	assert(resumeRes.status === 200 || resumeRes.status === 201, `Expected 200/201, got ${resumeRes.status}`);
	assert(resumeBody.status === 'active', `Expected active, got ${resumeBody.status}`);
	console.log('    PASS\n');

	// =========================================================================
	// Step 9: Verify — bad admin token rejected
	// =========================================================================
	console.log('  Step 9: Verify — bad admin token (should 401)...');
	const badRes = await fetch(`${SERVER}/api/v1/signers/${result.signerId}/pause`, {
		method: 'POST',
		headers: {
			'X-Admin-Token': 'deadbeef'.repeat(8),
		},
	});
	console.log(`    Status: ${badRes.status}`);
	assert(badRes.status === 401, `Expected 401, got ${badRes.status}`);
	console.log('    PASS\n');

	// =========================================================================
	// Step 10: Verify — exchange hash for short-lived JWT
	// =========================================================================
	console.log('  Step 10: Verify — exchange hash for admin JWT...');
	const tokenRes = await fetch(`${SERVER}/api/v1/auth/admin-token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ signerId: result.signerId, adminToken: hash }),
	});
	const tokenBody = await tokenRes.json() as { token: string; expiresIn: string };
	console.log(`    Status: ${tokenRes.status}`);
	console.log(`    Token: ${tokenBody.token?.slice(0, 30)}...`);
	console.log(`    Expires: ${tokenBody.expiresIn}`);
	assert(tokenRes.status === 200 || tokenRes.status === 201, `Expected 200/201, got ${tokenRes.status}`);
	assert(tokenBody.token?.startsWith('eyJ'), 'Token should be JWT');
	console.log('    PASS\n');

	// =========================================================================
	// Step 11: Verify — JWT works for admin action
	// =========================================================================
	console.log('  Step 11: Verify — JWT admin auth (POST /signers/:id/pause)...');
	const jwtPauseRes = await fetch(`${SERVER}/api/v1/signers/${result.signerId}/pause`, {
		method: 'POST',
		headers: { 'X-Admin-Token': tokenBody.token },
	});
	const jwtBody = await jwtPauseRes.json() as { status: string };
	console.log(`    Status: ${jwtPauseRes.status}, signer: ${jwtBody.status}`);
	assert(jwtPauseRes.status === 200 || jwtPauseRes.status === 201, `Expected 200/201, got ${jwtPauseRes.status}`);
	assert(jwtBody.status === 'paused', `Expected paused, got ${jwtBody.status}`);
	console.log('    PASS\n');

	// =========================================================================
	// Cleanup
	// =========================================================================
	console.log('  Cleaning up test files...');
	try { rmSync(configPath); } catch {}
	try { rmSync(userSharePath); } catch {}
	try { rmSync(adminPath); } catch {}
	console.log('    Done\n');

	console.log('  ==========================================');
	console.log('  ALL 11 STEPS PASSED — anon init flow works');
	console.log('  ==========================================\n');
}

function assert(condition: unknown, msg: string): asserts condition {
	if (!condition) throw new Error(`ASSERTION FAILED: ${msg}`);
}

main().catch((err) => {
	console.error(`\n  FAILED: ${err.message}\n`);
	process.exit(1);
});
