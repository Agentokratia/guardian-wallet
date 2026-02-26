import { IsIn, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * POST /auth/transfer/initiate — Start a share transfer.
 */
export class InitiateTransferDto {
	@IsUUID()
	@IsNotEmpty()
	signerId!: string;

	@IsString()
	@IsIn(['cli_to_dashboard', 'dashboard_to_cli'])
	direction!: 'cli_to_dashboard' | 'dashboard_to_cli';
}

/**
 * PATCH /auth/transfer/:id — Upload encrypted share payload.
 * A real encrypted share is ~10-20KB base64. 500KB is generous.
 */
export class UploadPayloadDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(500_000)
	encryptedPayload!: string;
}
