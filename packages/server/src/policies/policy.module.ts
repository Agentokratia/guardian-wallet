import { Module } from '@nestjs/common';
import { SignerModule } from '../signers/signer.module.js';
import { PolicyDocumentRepository } from './policy-document.repository.js';
import { PolicyDocumentService } from './policy-document.service.js';
import { PolicyEngineProvider } from './policy-engine.provider.js';
import { PolicyController } from './policy.controller.js';
import { PolicyRepository } from './policy.repository.js';
import { PolicyService } from './policy.service.js';
import { RulesEngineProvider } from './rules-engine.provider.js';

@Module({
	imports: [SignerModule],
	controllers: [PolicyController],
	providers: [
		PolicyEngineProvider,
		PolicyRepository,
		PolicyService,
		RulesEngineProvider,
		PolicyDocumentRepository,
		PolicyDocumentService,
	],
	exports: [PolicyEngineProvider, PolicyRepository, RulesEngineProvider, PolicyDocumentRepository],
})
export class PolicyModule {}
