import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PolicyEngineProvider } from '../policies/policy-engine.provider.js';
import { PolicyModule } from '../policies/policy.module.js';
import { RulesEngineProvider } from '../policies/rules-engine.provider.js';
import { SignerModule } from '../signers/signer.module.js';
import { InteractiveSignService } from './interactive-sign.service.js';
import { SigningController } from './signing.controller.js';

@Module({
	imports: [AuditModule, PolicyModule, SignerModule],
	controllers: [SigningController],
	providers: [
		InteractiveSignService,
		{
			provide: 'POLICY_ENGINE',
			useExisting: PolicyEngineProvider,
		},
		{
			provide: 'RULES_ENGINE',
			useExisting: RulesEngineProvider,
		},
	],
})
export class SigningModule {}
