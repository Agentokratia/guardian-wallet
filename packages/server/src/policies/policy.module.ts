import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { SignerModule } from '../signers/signer.module.js';
import { PolicyBacktestService } from './policy-backtest.service.js';
import { PolicyDocumentRepository } from './policy-document.repository.js';
import { PolicyDocumentService } from './policy-document.service.js';
import { PolicyController } from './policy.controller.js';
import { PolicyRepository } from './policy.repository.js';
import { PolicyService } from './policy.service.js';
import { RulesEngineProvider } from './rules-engine.provider.js';

@Module({
	imports: [SignerModule, AuditModule],
	controllers: [PolicyController],
	providers: [
		PolicyRepository,
		PolicyService,
		RulesEngineProvider,
		PolicyDocumentRepository,
		PolicyDocumentService,
		PolicyBacktestService,
		{
			provide: 'RULES_ENGINE',
			useExisting: RulesEngineProvider,
		},
	],
	exports: [PolicyRepository, RulesEngineProvider, PolicyDocumentRepository],
})
export class PolicyModule {}
