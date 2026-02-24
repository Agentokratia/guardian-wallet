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

const DIGIT_TD =
	'<td style="padding:0 4px"><div style="width:48px;height:56px;background:#f5f5f3;border:1.5px solid #e0e0de;border-radius:8px;text-align:center;line-height:56px;font-size:28px;font-weight:700;color:#1a1a1a;font-family:\'SF Mono\',SFMono-Regular,Consolas,\'Liberation Mono\',Menlo,monospace">{{DIGIT}}</div></td>';

export function renderOtpEmail(code: string): { subject: string; text: string; html: string } {
	if (!/^\d{6}$/.test(code)) {
		throw new Error('OTP code must be exactly 6 digits');
	}

	const digits = code
		.split('')
		.map((d) => DIGIT_TD.replace('{{DIGIT}}', d))
		.join('\n    ');
	const html = template.replace('{{OTP_DIGITS}}', digits);

	const text = [
		'Guardian Wallet',
		'',
		'Enter this code to verify your identity:',
		'',
		`  ${code}`,
		'',
		'This code expires in 10 minutes.',
		'',
		"If you didn't request this, you can safely ignore this email.",
		'No changes have been made to your account.',
		'',
		'— Guardian Wallet by Agentokratia',
	].join('\n');

	return {
		subject: `${code} — Guardian Wallet verification`,
		text,
		html,
	};
}
