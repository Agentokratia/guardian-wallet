import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { SigningRequestRepository } from './signing-request.repository.js';

@Module({
	controllers: [AuditController],
	providers: [SigningRequestRepository],
	exports: [SigningRequestRepository],
})
export class AuditModule {}
