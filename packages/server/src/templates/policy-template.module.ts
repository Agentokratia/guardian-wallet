import { Module } from '@nestjs/common';
import { PolicyTemplateController } from './policy-template.controller.js';
import { PolicyTemplateRepository } from './policy-template.repository.js';

@Module({
	controllers: [PolicyTemplateController],
	providers: [PolicyTemplateRepository],
	exports: [PolicyTemplateRepository],
})
export class PolicyTemplateModule {}
