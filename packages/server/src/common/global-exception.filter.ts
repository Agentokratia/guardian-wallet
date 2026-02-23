import {
	type ArgumentsHost,
	Catch,
	type ExceptionFilter,
	HttpException,
	HttpStatus,
	Logger,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
	private readonly logger = new Logger(GlobalExceptionFilter.name);

	catch(exception: unknown, host: ArgumentsHost): void {
		const ctx = host.switchToHttp();
		const response = ctx.getResponse<Response>();
		const request = ctx.getRequest<{ method?: string; url?: string; ip?: string }>();
		const reqTag = `${request.method ?? '?'} ${request.url ?? '?'}`;

		let status = HttpStatus.INTERNAL_SERVER_ERROR;
		let message = 'Internal server error';
		let violations: unknown[] | undefined;

		if (exception instanceof HttpException) {
			status = exception.getStatus();
			const exResponse = exception.getResponse();

			if (typeof exResponse === 'string') {
				message = exResponse;
			} else {
				const body = exResponse as Record<string, unknown>;
				message = (body.message as string) ?? exception.message;

				if (status === HttpStatus.FORBIDDEN && Array.isArray(body.violations)) {
					violations = body.violations as unknown[];
				}
			}

			// Log 4xx/5xx with request context for debugging
			if (status >= 400) {
				const level = status >= 500 ? 'error' : 'warn';
				this.logger[level](`[${reqTag}] ${status} ${message}`);
			}
		} else if (exception instanceof Error) {
			this.logger.error(`[${reqTag}] Unhandled: ${exception.message}`, exception.stack);
		} else {
			this.logger.error(`[${reqTag}] Non-Error exception: ${String(exception)}`);
		}

		const responseBody: Record<string, unknown> = {
			statusCode: status,
			message,
			timestamp: new Date().toISOString(),
		};

		if (violations !== undefined) {
			responseBody.violations = violations;
		}

		response.status(status).json(responseBody);
	}
}
