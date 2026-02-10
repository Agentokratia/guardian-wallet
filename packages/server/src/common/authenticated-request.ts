import type { Request } from 'express';

export interface AuthenticatedRequest extends Request {
	signerId?: string;
	sessionUser?: string;
}
