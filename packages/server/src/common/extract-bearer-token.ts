/** Extract JWT from `Authorization: Bearer <token>` header (case-insensitive per RFC 7235). */
export function extractBearerToken(header: string | undefined): string | undefined {
	if (!header || header.length < 8) return undefined;
	if (header.slice(0, 7).toLowerCase() !== 'bearer ') return undefined;
	return header.slice(7);
}
