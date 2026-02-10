import { useAuth } from '@/hooks/use-auth';
import { Loader2 } from 'lucide-react';
import { Navigate } from 'react-router-dom';

export function AuthGuard({ children }: { children: React.ReactNode }) {
	const { isAuthenticated, loading } = useAuth();

	if (loading) {
		return (
			<div className="flex h-screen w-screen items-center justify-center bg-background">
				<Loader2 className="h-6 w-6 animate-spin text-accent" />
			</div>
		);
	}

	if (!isAuthenticated) {
		return <Navigate to="/login" replace />;
	}

	return children;
}
