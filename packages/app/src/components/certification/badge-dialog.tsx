import { Dialog, DialogContent } from '@/components/ui/dialog';
import type { CertificationScore } from '@/lib/certification-score';
import { EmbeddableBadges } from './embeddable-badges';

interface BadgeDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	cert: CertificationScore;
	address: string;
	name: string;
}

export function BadgeDialog({ open, onOpenChange, cert, address, name }: BadgeDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="border-border bg-background sm:max-w-md gap-0 p-0 overflow-hidden">
				<EmbeddableBadges cert={cert} address={address} name={name} />
			</DialogContent>
		</Dialog>
	);
}
