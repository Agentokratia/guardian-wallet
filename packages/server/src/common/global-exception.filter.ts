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
		} else if (exception instanceof Error) {
			this.logger.error(exception.message, exception.stack);
		} else {
			this.logger.error(`Non-Error exception caught: ${String(exception)}`);
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
