import { Module } from '@nestjs/common';
import { TokenRepository } from './token.repository.js';
import { TokenService } from './token.service.js';

@Module({
	providers: [TokenRepository, TokenService],
	exports: [TokenService],
})
export class TokenModule {}
