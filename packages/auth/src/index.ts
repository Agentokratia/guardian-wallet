// This package has three entry points:
//   @agentokratia/guardian-auth/browser — browser-only (WebAuthn client, PRF wallet)
//   @agentokratia/guardian-auth/server  — server-only (WebAuthn server, OTP, challenge store)
//   @agentokratia/guardian-auth/shared  — shared types (used by both)
//
// Import from the specific entry point, not from the root.
// Example:
//   import { deriveEOAFromPRF } from '@agentokratia/guardian-auth/browser';
//   import { generateOTP } from '@agentokratia/guardian-auth/server';
//   import type { PRFWalletResult } from '@agentokratia/guardian-auth/shared';

export type {} from './shared/index.js';
