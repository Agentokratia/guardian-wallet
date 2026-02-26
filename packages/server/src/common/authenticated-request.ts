import type { Request } from 'express';

export interface AuthenticatedRequest extends Request {
	signerId?: string;
	sessionEmail?: string;
	sessionUserId?: string;
}
