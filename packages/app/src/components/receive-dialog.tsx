import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Check, Copy, Shield } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';

interface ReceiveDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	address: string;
	accountName: string;
}

export function ReceiveDialog({ open, onOpenChange, address, accountName }: ReceiveDialogProps) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(address);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="border-border bg-surface sm:max-w-[380px] p-0 overflow-hidden">
				{/* Header */}
				<div className="border-b border-border bg-surface px-6 pt-6 pb-5">
					<DialogHeader className="text-center">
						<DialogTitle className="text-text text-center text-lg">Receive</DialogTitle>
						<p className="text-[13px] text-text-muted text-center mt-1">{accountName}</p>
					</DialogHeader>

					{/* QR Code */}
					<div className="flex justify-center mt-5">
						<div className="rounded-2xl bg-white p-4 shadow-lg">
							<QRCodeSVG
								value={address}
								size={160}
								level="M"
								bgColor="#FFFFFF"
								fgColor="#18181B"
								includeMargin={false}
							/>
						</div>
					</div>
				</div>

				{/* Address section */}
				<div className="px-6 pb-6 pt-4">
					<p className="text-[11px] font-medium uppercase tracking-wider text-text-dim mb-2">
						Wallet Address
					</p>
					<button
						type="button"
						onClick={handleCopy}
						className={cn(
							'flex w-full items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-left transition-all hover:bg-surface-hover',
							copied && 'border-success/40 bg-success/[0.04]',
						)}
					>
						<code className="flex-1 break-all font-mono text-[12px] leading-relaxed text-text">
							{address}
						</code>
						<div className="shrink-0">
							{copied ? (
								<Check className="h-4 w-4 text-success" />
							) : (
								<Copy className="h-4 w-4 text-text-dim" />
							)}
						</div>
					</button>
					{copied && (
						<p className="text-xs font-medium text-success mt-2 text-center">Copied to clipboard</p>
					)}

					{/* Trust signal */}
					<div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-text-dim">
						<Shield className="h-3 w-3" />
						<span>Only send assets on the same network to this address</span>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
