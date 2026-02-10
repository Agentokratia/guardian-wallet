import { GuardianLogo } from '@/components/guardian-logo';
import { Button } from '@/components/ui/button';
import { Mono } from '@/components/ui/mono';
import { useAuth } from '@/hooks/use-auth';
import {
	ArrowRight,
	Check,
	ChevronDown,
	ExternalLink,
	Github,
	Loader2,
	Lock,
	MessageSquare,
	Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';

/* ========================================================================== */
/*  Data                                                                       */
/* ========================================================================== */

const PROMISES = [
	{
		headline: 'A wallet that holds value, not risk.',
		body: 'The private key is split into three shares — it never exists as a whole. Not during creation. Not during signing. Not ever. Agents get spending power. The key stays impossible to steal.',
	},
	{
		headline: 'Autonomy with guardrails.',
		body: 'Spending limits. Allowlists. Time windows. Agents operate freely within rules that math enforces. Every transaction logged. Every policy honored. No exceptions.',
	},
	{
		headline: 'Three paths in. Zero ways to lose.',
		body: 'Server goes down? Two shares still sign. A share leaks? One share is useless alone. Funds stay accessible through three independent signing paths. Recovery is built into the architecture.',
	},
];

const TRUST_NUMBERS = [
	{ value: '0', label: 'Keys exposed', sublabel: 'ever' },
	{ value: '3', label: 'Shares per key', sublabel: 'any 2 can sign' },
	{ value: '<500ms', label: 'To sign', sublabel: 'per transaction' },
	{ value: '100%', label: 'Self-hosted', sublabel: 'own infra, own rules' },
];

const FAQ_ITEMS = [
	{
		q: 'How is this different from a regular wallet?',
		a: 'In a regular wallet, the private key exists as a single secret. If compromised, all funds are lost. Guardian splits the key into 3 shares using threshold cryptography — the full key is never constructed, not even during signing. Any 2 of 3 shares can co-sign a transaction through a distributed computation.',
	},
	{
		q: 'What happens if one share is compromised?',
		a: 'A single share is useless. An attacker needs 2 of 3 shares to sign anything. Key rotation generates new shares without changing the wallet address, immediately invalidating the compromised share.',
	},
	{
		q: 'Can agents sign transactions autonomously?',
		a: 'Yes. The Signer + Server path lets agents sign using their share and the server share, without any human intervention. Policy rules (spending limits, allowlists, rate limits) control what the agent can do.',
	},
	{
		q: 'What if the server goes down?',
		a: 'Two shares remain: the signer share and the user share. These co-sign directly without the server, ensuring funds are always accessible.',
	},
	{
		q: 'Which chains are supported?',
		a: 'Ethereum and all EVM-compatible chains (Base, Arbitrum, Optimism, Polygon, etc.) are supported today. The architecture is chain-agnostic — Bitcoin and Solana support is on the roadmap.',
	},
	{
		q: 'Is this self-hosted?',
		a: 'Yes. Guardian runs on dedicated infrastructure. Docker Compose brings up the server, Vault, and database in one command. The operator owns the shares, the policies, and the audit log.',
	},
];

/* ========================================================================== */
/*  Sub-components                                                             */
/* ========================================================================== */

function NavBar({ onConnect, connecting }: { onConnect: () => void; connecting: boolean }) {
	return (
		<nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/60 bg-[var(--bg)]/80 backdrop-blur-xl">
			<div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
				<div className="flex items-center gap-2.5">
					<GuardianLogo width={24} height={24} />
					<span className="text-sm font-bold text-text font-serif">Guardian</span>
					<span className="hidden sm:inline text-[11px] text-text-dim font-mono">by Agentokratia</span>
				</div>
				<div className="hidden md:flex items-center gap-6">
					<a href="#why" className="text-[13px] text-text-muted hover:text-text transition-colors">
						Why Guardian
					</a>
					<a href="#how" className="text-[13px] text-text-muted hover:text-text transition-colors">
						How It Works
					</a>
					<a href="#faq" className="text-[13px] text-text-muted hover:text-text transition-colors">
						FAQ
					</a>
					<button
						type="button"
						onClick={onConnect}
						disabled={connecting}
						className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
					>
						{connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />}
						{connecting ? 'Connecting...' : 'Launch App'}
					</button>
				</div>
				<button
					type="button"
					onClick={onConnect}
					disabled={connecting}
					className="md:hidden inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
				>
					{connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Launch App'}
				</button>
			</div>
		</nav>
	);
}

function FaqItem({ q, a }: { q: string; a: string }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="border-b border-border last:border-0">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex w-full items-center justify-between py-5 text-left"
			>
				<span className="text-[15px] font-medium text-text pr-4">{q}</span>
				<ChevronDown
					className={`h-4 w-4 shrink-0 text-text-dim transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
				/>
			</button>
			{open && (
				<div className="pb-5 pr-8">
					<p className="text-[14px] leading-relaxed text-text-muted">{a}</p>
				</div>
			)}
		</div>
	);
}

/* ========================================================================== */
/*  Main page                                                                  */
/* ========================================================================== */

export function LoginPage() {
	const { isAuthenticated, loading: authLoading, address, login } = useAuth();
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	if (authLoading) {
		return (
			<div className="flex h-screen w-screen items-center justify-center bg-background">
				<Loader2 className="h-6 w-6 animate-spin text-accent" />
			</div>
		);
	}

	if (isAuthenticated) {
		return <Navigate to="/signers" replace />;
	}

	async function handleLogin() {
		setError(null);
		setLoading(true);
		try {
			await login();
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'Wallet authentication failed';
			setError(message);
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="min-h-screen bg-[var(--bg)]">
			<NavBar onConnect={handleLogin} connecting={loading} />

			{/* ================================================================ */}
			{/*  HERO — Emotion first                                            */}
			{/* ================================================================ */}
			<section className="relative flex min-h-screen flex-col items-center justify-center px-6 pt-14">
				<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgba(26,26,26,0.03)_0%,transparent_70%)]" />

				<div className="relative mx-auto max-w-3xl text-center">
					<p className="text-[13px] font-medium text-text-muted mb-6">
						Guardian by Agentokratia
					</p>

					<h1 className="font-serif text-[clamp(2.8rem,7vw,4.5rem)] font-normal leading-[1.05] tracking-tight text-text">
						Agents deserve wallets
						<br />
						<em className="font-serif text-text-muted">without private keys.</em>
					</h1>

					<p className="mx-auto mt-8 max-w-md text-[18px] leading-relaxed text-text-muted">
						The private key never exists. Not in memory, not in transit, not ever. Agents transact with full autonomy. The key stays impossible to steal.
					</p>

					{/* Wallet connect — primary CTA */}
					<div className="mt-10 flex flex-col items-center gap-4">
						{error && (
							<div className="w-full max-w-sm rounded-md border border-danger/30 bg-danger-muted px-4 py-3 text-sm text-danger">
								{error}
							</div>
						)}

						{address && !isAuthenticated && (
							<div className="w-full max-w-sm rounded-md border border-accent/30 bg-accent-muted px-4 py-3 text-center">
								<Mono size="xs" className="text-accent">
									{address}
								</Mono>
							</div>
						)}

						<div className="flex flex-col sm:flex-row items-center gap-3">
							<Button size="lg" onClick={handleLogin} disabled={loading} className="min-w-[220px] h-12 text-[15px]">
								{loading ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<Wallet className="h-4 w-4" />
								)}
								{loading ? 'Connecting...' : 'Connect Wallet'}
							</Button>
							<a
								href="https://github.com/agentokratia"
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-2 rounded-md border border-border px-6 py-3 text-[15px] font-medium text-text hover:bg-surface transition-colors"
							>
								<Github className="h-4 w-4" />
								Docs
							</a>
						</div>

						<div className="mt-6 flex items-center justify-center gap-5 flex-wrap">
							<div className="flex items-center gap-1.5 text-[12px] text-text-dim">
								<Check className="h-3 w-3 text-success" />
								Independently audited
							</div>
							<div className="flex items-center gap-1.5 text-[12px] text-text-dim">
								<Check className="h-3 w-3 text-success" />
								Same security as MetaMask
							</div>
							<div className="flex items-center gap-1.5 text-[12px] text-text-dim">
								<Check className="h-3 w-3 text-success" />
								Open source &amp; self-hosted
							</div>
						</div>
					</div>
				</div>

				{/* Scroll indicator */}
				<div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
					<ChevronDown className="h-5 w-5 text-text-dim/40" />
				</div>
			</section>

			{/* ================================================================ */}
			{/*  THE TENSION — The problem we solve, emotionally                  */}
			{/* ================================================================ */}
			<section className="border-t border-[#2a2a2a] bg-[#1a1a1a] px-6 py-28">
				<div className="mx-auto max-w-3xl text-center">
					<p className="font-serif text-[clamp(1.6rem,4vw,2.4rem)] font-normal leading-[1.25] text-white">
						Every key is a liability.
					</p>
					<p className="mt-4 font-serif text-[clamp(1.6rem,4vw,2.4rem)] font-normal leading-[1.25] text-white/40">
						Guardian is the wallet that eliminates it.
					</p>
					<div className="mx-auto mt-8 h-px w-16 bg-white/10" />
					<p className="mt-8 text-[16px] leading-relaxed text-white/50 max-w-md mx-auto">
						Guardian splits the private key into three shares. The full key is never constructed — not during creation, not during signing. Agents transact freely. Math enforces the rules.
					</p>
				</div>
			</section>

			{/* ================================================================ */}
			{/*  PROMISES — What you feel, not what you get                       */}
			{/* ================================================================ */}
			<section id="why" className="border-t border-border px-6 py-24">
				<div className="mx-auto max-w-4xl">
					<div className="text-center mb-20">
						<p className="text-[12px] font-bold uppercase tracking-[0.2em] text-text-dim mb-3">
							Why Guardian
						</p>
						<h2 className="font-serif text-[clamp(1.8rem,4vw,2.5rem)] font-normal text-text leading-[1.15]">
							Built for agents that handle real value.
						</h2>
					</div>

					<div className="space-y-20">
						{PROMISES.map((p, i) => (
							<div key={p.headline} className={`flex flex-col md:flex-row gap-8 md:gap-16 items-start ${i % 2 === 1 ? 'md:flex-row-reverse' : ''}`}>
								<div className="flex-1">
									<h3 className="font-serif text-2xl font-normal text-text mb-4">
										{p.headline}
									</h3>
									<p className="text-[16px] leading-relaxed text-text-muted">
										{p.body}
									</p>
								</div>
								<div className="w-full md:w-64 shrink-0">
									<div className="aspect-square rounded-2xl bg-gradient-to-br from-[#18181B] to-[#27272A] flex items-center justify-center">
										<div className="text-center px-6">
											<div className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/30 mb-3">
												{i === 0 ? 'Key Security' : i === 1 ? 'Policy Engine' : 'Recovery'}
											</div>
											<div className="font-serif text-lg text-white/80">
												{i === 0 ? '2-of-3 threshold' : i === 1 ? 'Rules, not hope' : '3 signing paths'}
											</div>
											<div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-white/25">
												<Lock className="h-2.5 w-2.5" />
												<span>{i === 0 ? 'Distributed key generation' : i === 1 ? 'Enforced on-sign' : 'Never locked out'}</span>
											</div>
										</div>
									</div>
								</div>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* ================================================================ */}
			{/*  TRUST NUMBERS — Proof, not claims                               */}
			{/* ================================================================ */}
			<section className="border-t border-border bg-surface px-6 py-20">
				<div className="mx-auto max-w-4xl">
					<div className="grid grid-cols-2 gap-6 md:grid-cols-4">
						{TRUST_NUMBERS.map((n) => (
							<div key={n.label} className="text-center">
								<div className="text-[clamp(2rem,5vw,3rem)] font-bold tabular-nums text-text leading-none">
									{n.value}
								</div>
								<div className="mt-2 text-[14px] font-medium text-text">
									{n.label}
								</div>
								<div className="mt-0.5 text-[12px] text-text-dim">
									{n.sublabel}
								</div>
							</div>
						))}
					</div>
					</div>
			</section>

			{/* ================================================================ */}
			{/*  HOW IT WORKS — Brief, earned the right                          */}
			{/* ================================================================ */}
			<section id="how" className="border-t border-border px-6 py-24">
				<div className="mx-auto max-w-4xl">
					<div className="text-center mb-16">
						<p className="text-[12px] font-bold uppercase tracking-[0.2em] text-text-dim mb-3">
							How It Works
						</p>
						<h2 className="font-serif text-3xl font-normal text-text">
							Three shares. Two to sign. Zero exposure.
						</h2>
					</div>

					{/* Code block */}
					<div className="overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#1a1a1a]">
						<div className="flex items-center gap-2 border-b border-[#2a2a2a] px-4 py-2.5">
							<div className="flex gap-1.5">
								<div className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
								<div className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
								<div className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
							</div>
							<span className="ml-2 font-mono text-[11px] text-[#6b6b6b]">agent.ts</span>
						</div>
						<pre className="overflow-x-auto p-5 text-[13px] leading-relaxed font-mono">
							<code>
								<span className="text-[#7c7c7c]">{'// An agent gets a wallet. The key never exists.\n'}</span>
								<span className="text-[#c586c0]">import</span>
								<span className="text-[#d4d4d4]">{' { ThresholdSigner } '}</span>
								<span className="text-[#c586c0]">from</span>
								<span className="text-[#ce9178]">{" '@guardian/signer'"}</span>
								<span className="text-[#d4d4d4]">;</span>
								{'\n\n'}
								<span className="text-[#569cd6]">const</span>
								<span className="text-[#4fc1ff]"> signer</span>
								<span className="text-[#d4d4d4]">{' = '}</span>
								<span className="text-[#c586c0]">await</span>
								<span className="text-[#dcdcaa]"> ThresholdSigner</span>
								<span className="text-[#d4d4d4]">.</span>
								<span className="text-[#dcdcaa]">fromEncryptedShare</span>
								<span className="text-[#d4d4d4]">(</span>
								<span className="text-[#ce9178]">'./agent.share.enc'</span>
								<span className="text-[#d4d4d4]">);</span>
								{'\n'}
								<span className="text-[#569cd6]">const</span>
								<span className="text-[#4fc1ff]"> account</span>
								<span className="text-[#d4d4d4]">{' = signer.'}</span>
								<span className="text-[#dcdcaa]">toAccount</span>
								<span className="text-[#d4d4d4]">();</span>
								<span className="text-[#7c7c7c]">{' // drop-in viem account'}</span>
								{'\n\n'}
								<span className="text-[#7c7c7c]">{'// Sign like any wallet. The math does the rest.\n'}</span>
								<span className="text-[#569cd6]">const</span>
								<span className="text-[#4fc1ff]"> hash</span>
								<span className="text-[#d4d4d4]">{' = '}</span>
								<span className="text-[#c586c0]">await</span>
								<span className="text-[#d4d4d4]">{' walletClient.'}</span>
								<span className="text-[#dcdcaa]">sendTransaction</span>
								<span className="text-[#d4d4d4]">(</span>
								<span className="text-[#d4d4d4]">{'{ account, to, value }'}</span>
								<span className="text-[#d4d4d4]">);</span>
							</code>
						</pre>
					</div>

					<p className="mt-6 text-center text-[14px] text-text-muted">
						One import. One function call. Agents sign transactions with threshold security — the key is never in one place.
					</p>
				</div>
			</section>

			{/* ================================================================ */}
			{/*  CTA — Emotional close                                           */}
			{/* ================================================================ */}
			<section className="border-t border-[#2a2a2a] bg-[#1a1a1a] px-6 py-28">
				<div className="mx-auto max-w-3xl text-center">
					<h2 className="font-serif text-[clamp(2rem,5vw,3rem)] font-normal leading-[1.1] text-white">
						Agents move money.
						<br />
						<em className="font-serif text-white/40">Keys don't move at all.</em>
					</h2>
					<div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
						<Button
							size="lg"
							onClick={handleLogin}
							disabled={loading}
							className="bg-white text-[#1a1a1a] hover:bg-white/90 min-w-[220px] h-12 text-[15px]"
						>
							{loading ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<ArrowRight className="h-4 w-4" />
							)}
							{loading ? 'Connecting...' : 'Get Started'}
						</Button>
						<a
							href="https://t.me/agentokratia"
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-2 rounded-md border border-white/20 px-6 py-3 text-[15px] font-medium text-white hover:bg-white/10 transition-colors"
						>
							<MessageSquare className="h-4 w-4" />
							Talk to us
						</a>
					</div>
					<p className="mt-6 text-[13px] text-white/30">
						Self-hosted. Docker Compose up. Five minutes to first transaction.
					</p>
				</div>
			</section>

			{/* ================================================================ */}
			{/*  FAQ                                                             */}
			{/* ================================================================ */}
			<section id="faq" className="border-t border-border px-6 py-24">
				<div className="mx-auto max-w-2xl">
					<h2 className="font-serif text-3xl font-normal text-text text-center mb-12">
						Questions
					</h2>
					<div className="rounded-xl border border-border bg-surface px-6">
						{FAQ_ITEMS.map((item) => (
							<FaqItem key={item.q} q={item.q} a={item.a} />
						))}
					</div>
				</div>
			</section>

			{/* ================================================================ */}
			{/*  FOOTER                                                          */}
			{/* ================================================================ */}
			<footer className="border-t border-[#2a2a2a] bg-[#1a1a1a] px-6 py-12">
				<div className="mx-auto max-w-5xl">
					<div className="flex flex-col md:flex-row md:items-start md:justify-between gap-8">
						<div>
							<div className="flex items-center gap-2.5">
								<GuardianLogo width={24} height={24} className="text-white" />
								<span className="text-sm font-bold text-white font-serif">Guardian</span>
							</div>
							<p className="mt-2 text-[13px] text-white/40 max-w-xs">
								Agents deserve wallets, not keys.
							</p>
						</div>

						<div className="flex gap-16">
							<div>
								<div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30 mb-3">
									Resources
								</div>
								<div className="space-y-2">
									{[
										{ label: 'Documentation', href: 'https://github.com/agentokratia' },
										{ label: 'GitHub', href: 'https://github.com/agentokratia' },
										{ label: 'API Reference', href: 'https://github.com/agentokratia' },
									].map((link) => (
										<a
											key={link.label}
											href={link.href}
											target="_blank"
											rel="noopener noreferrer"
											className="flex items-center gap-1 text-[13px] text-white/50 hover:text-white transition-colors"
										>
											{link.label}
											<ExternalLink className="h-2.5 w-2.5" />
										</a>
									))}
								</div>
							</div>
							<div>
								<div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30 mb-3">
									Networks
								</div>
								<div className="space-y-2">
									{['Ethereum', 'Base', 'Arbitrum', 'Sepolia'].map((net) => (
										<div key={net} className="text-[13px] text-white/50">{net}</div>
									))}
								</div>
							</div>
						</div>
					</div>

					<div className="mt-10 flex items-center justify-between border-t border-white/10 pt-6">
						<div className="text-[11px] text-white/25">
							&copy; {new Date().getFullYear()} Agentokratia
						</div>
						<div className="flex items-center gap-1.5 text-[11px] text-white/25">
							<Lock className="h-3 w-3" />
							2-of-3 threshold signing
						</div>
					</div>
				</div>
			</footer>
		</div>
	);
}
