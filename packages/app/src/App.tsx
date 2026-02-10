import { Loader2 } from 'lucide-react';
import React, { Suspense, useEffect } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthGuard } from './components/auth-guard';
import { DashboardLayout } from './components/layout/dashboard-layout';
import { Toaster } from './components/ui/toaster';
import { useNetworks } from './hooks/use-networks';
import { useSigners } from './hooks/use-signers';
import { initChainLookups } from './lib/chains';
import { LoginPage } from './pages/login';
import { SetupPage } from './pages/setup';
import { SignersPage } from './pages/signers';

interface ErrorBoundaryProps {
	children: ReactNode;
}

interface ErrorBoundaryState {
	hasError: boolean;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(): ErrorBoundaryState {
		return { hasError: true };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		console.error('ErrorBoundary caught:', error, errorInfo);
	}

	render() {
		if (this.state.hasError) {
			return (
				<div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background text-text">
					<h1 className="text-xl font-bold">Something went wrong.</h1>
					<p className="text-sm text-text-muted">An unexpected error occurred. Please refresh the page.</p>
					<button
						type="button"
						onClick={() => window.location.reload()}
						className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
					>
						Reload Page
					</button>
				</div>
			);
		}
		return this.props.children;
	}
}

const SignPage = React.lazy(() =>
	import('./pages/sign').then((m) => ({ default: m.SignPage })),
);
const CreateSignerPage = React.lazy(() =>
	import('./pages/create-signer').then((m) => ({ default: m.CreateSignerPage })),
);
const AuditPage = React.lazy(() =>
	import('./pages/audit').then((m) => ({ default: m.AuditPage })),
);
const SignerDetailPage = React.lazy(() =>
	import('./pages/signer-detail').then((m) => ({ default: m.SignerDetailPage })),
);
const SettingsPage = React.lazy(() =>
	import('./pages/settings').then((m) => ({ default: m.SettingsPage })),
);
const AccountSettingsPage = React.lazy(() =>
	import('./pages/account-settings').then((m) => ({ default: m.AccountSettingsPage })),
);

function LazyFallback() {
	return (
		<div className="flex h-64 items-center justify-center">
			<Loader2 className="h-5 w-5 animate-spin text-accent" />
		</div>
	);
}

/**
 * Redirects authenticated users based on whether they have signers:
 * - No signers -> /setup (first-run experience)
 * - Has signers -> /signers (normal dashboard)
 */
function SignerRedirect() {
	const { data: signers, isLoading } = useSigners();

	if (isLoading) {
		return (
			<div className="flex h-screen w-screen items-center justify-center bg-background">
				<Loader2 className="h-6 w-6 animate-spin text-accent" />
			</div>
		);
	}

	if (signers && signers.length === 0) {
		return <Navigate to="/setup" replace />;
	}

	return <Navigate to="/signers" replace />;
}

/** Fetches networks from API and populates chain lookups. Renders nothing. */
function NetworkInitializer() {
	const { data: networks } = useNetworks();
	useEffect(() => {
		if (networks) {
			initChainLookups(networks);
		}
	}, [networks]);
	return null;
}

export function App() {
	return (
		<>
			<NetworkInitializer />
			<ErrorBoundary>
			<Suspense fallback={<LazyFallback />}>
				<Routes>
					{/* Public routes (no sidebar) */}
					<Route path="/login" element={<LoginPage />} />

					{/* Protected routes without sidebar */}
					<Route
						path="/setup"
						element={
							<AuthGuard>
								<SetupPage />
							</AuthGuard>
						}
					/>
					<Route
						path="/signers/new"
						element={
							<AuthGuard>
								<div className="min-h-screen bg-background px-8 py-7">
									<CreateSignerPage />
								</div>
							</AuthGuard>
						}
					/>

					{/* Protected dashboard routes (with sidebar) */}
					<Route
						element={
							<AuthGuard>
								<DashboardLayout />
							</AuthGuard>
						}
					>
						<Route path="/signers" element={<SignersPage />} />
						<Route path="/signers/:id" element={<SignerDetailPage />} />
						<Route path="/signers/:id/settings" element={<AccountSettingsPage />} />
						<Route path="/signers/:id/sign" element={<SignPage />} />
						<Route path="/audit" element={<AuditPage />} />
						<Route path="/settings" element={<SettingsPage />} />
					</Route>

					{/* Catch-all: redirect based on signer count */}
					<Route
						path="*"
						element={
							<AuthGuard>
								<SignerRedirect />
							</AuthGuard>
						}
					/>
				</Routes>
			</Suspense>
			</ErrorBoundary>
			<Toaster />
		</>
	);
}
