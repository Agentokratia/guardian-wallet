import type { Config } from 'tailwindcss';
import tailwindAnimate from 'tailwindcss-animate';

const config: Config = {
	content: ['./src/**/*.{ts,tsx}'],
	theme: {
		extend: {
			colors: {
				background: '#FAFAF8',
				surface: {
					DEFAULT: '#F2F2EF',
					hover: '#E5E5E2',
				},
				border: '#E5E5E2',
				'border-light': '#D4D4D1',
				accent: {
					DEFAULT: '#1A1A1A',
					hover: '#333333',
					muted: 'rgba(26,26,26,0.06)',
					foreground: '#ffffff',
				},
				success: {
					DEFAULT: '#22C55E',
					muted: 'rgba(34,197,94,0.10)',
				},
				warning: {
					DEFAULT: '#F59E0B',
					muted: 'rgba(245,158,11,0.10)',
				},
				danger: {
					DEFAULT: '#EF4444',
					muted: 'rgba(239,68,68,0.10)',
				},
				text: {
					DEFAULT: '#1A1A1A',
					muted: '#6B6B6B',
					dim: '#9CA3AF',
				},
				// shadcn compat
				input: '#E5E5E2',
				ring: '#1A1A1A',
				primary: {
					DEFAULT: '#1A1A1A',
					foreground: '#ffffff',
				},
				secondary: {
					DEFAULT: '#F2F2EF',
					foreground: '#1A1A1A',
				},
				destructive: {
					DEFAULT: '#EF4444',
					foreground: '#ffffff',
				},
				muted: {
					DEFAULT: '#F2F2EF',
					foreground: '#6B6B6B',
				},
				popover: {
					DEFAULT: '#FFFFFF',
					foreground: '#1A1A1A',
				},
				card: {
					DEFAULT: '#FFFFFF',
					foreground: '#1A1A1A',
				},
			},
			fontFamily: {
				mono: ['Space Mono', 'monospace'],
				sans: ['DM Sans', 'sans-serif'],
				serif: ['Newsreader', 'serif'],
			},
			borderRadius: {
				lg: '12px',
				md: '8px',
				sm: '6px',
			},
		},
	},
	plugins: [tailwindAnimate],
};

export default config;
