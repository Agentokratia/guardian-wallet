import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig } from './common/config.js';

async function bootstrap() {
	const app = await NestFactory.create<NestExpressApplication>(AppModule);
	const logger = new Logger('Bootstrap');

	const config = app.get<AppConfig>(APP_CONFIG);

	app.useBodyParser('json', { limit: '2mb' });
	app.use(cookieParser());

	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true,
		}),
	);

	const origins = process.env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean)
		|| ['http://localhost:3000'];
	app.enableCors({
		origin: origins,
		credentials: true,
	});

	app.setGlobalPrefix('api/v1');
	await app.listen(config.PORT);
	logger.log(`Server running on port ${config.PORT} — CORS origins: ${origins.join(', ')}`);
}

bootstrap();
