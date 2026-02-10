import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, parseConfig } from './config.js';

@Global()
@Module({
	providers: [
		{
			provide: APP_CONFIG,
			useFactory: () => {
				try {
					return parseConfig();
				} catch (error) {
					throw new Error(
						`Invalid environment configuration: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			},
		},
	],
	exports: [APP_CONFIG],
})
export class ConfigModule {}
