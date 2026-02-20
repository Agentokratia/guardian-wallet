/** Extract JWT from `Authorization: Bearer <token>` header. */
export function extractBearerToken(header: string | undefined): string | undefined {
	if (!header?.startsWith('Bearer ')) return undefined;
	return header.slice(7);
}
