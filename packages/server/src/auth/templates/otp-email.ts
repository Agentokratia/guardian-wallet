import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

let template: string;
try {
	template = readFileSync(join(__dirname, 'otp-email.html'), 'utf-8');
} catch {
	throw new Error(
		'Missing otp-email.html template. Run the build first: tsc && cp src/auth/templates/*.html dist/auth/templates/',
	);
}

export function renderOtpEmail(code: string): { subject: string; text: string; html: string } {
	if (!/^\d{6}$/.test(code)) {
		throw new Error('OTP code must be exactly 6 digits');
	}

	const html = template.replace('{{OTP_CODE}}', code);

	const text = [
		'Log in to Guardian Wallet',
		'',
		`Your code is: ${code}`,
		'',
		'This code expires in 10 minutes. Do not share this code with anyone.',
		'',
		"Wasn't you? You can safely ignore this email.",
		'No changes have been made to your account.',
		'',
		'— Guardian Wallet by Agentokratia',
	].join('\n');

	return {
		subject: 'Your Guardian Wallet login code',
		text,
		html,
	};
}
