import 'server-only';
import { createHash } from 'node:crypto';
import { createAdminClient } from './supabase/admin';
import { appOrigin, isAllowedEmail, SetupError } from './supabase/config';
import type { OperationGuard } from './store';

export const MCP_AUTH_SCOPES = ['diet:read', 'diet:write'] as const;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type McpIdentity = { userId: string; email: string; fullName: string | null; clientId: string; scopes: string[]; guard: OperationGuard; };
export function mcpResource() { return `${appOrigin()}/api/mcp`; }
export function mcpIssuer() { return appOrigin(); }
export function mcpTokenHash(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function mcpMetadata() { return { resource: mcpResource(), authorization_servers: [mcpIssuer()], scopes_supported: [...MCP_AUTH_SCOPES], bearer_methods_supported: ['header'], resource_name: 'Remy Mux diet journal', resource_documentation: `${appOrigin()}/oauth/connections` }; }
export function mcpChallenge(error: 'invalid_token' | 'insufficient_scope' = 'invalid_token') { return `Bearer resource_metadata="${appOrigin()}/.well-known/oauth-protected-resource/api/mcp", error="${error}", error_description="Connect your Remy Mux owner account to continue", scope="${MCP_AUTH_SCOPES.join(' ')}"`; }
export class McpAuthorizationError extends Error { readonly status = 401; constructor() { super('Connect your Remy Mux owner account to continue.'); } }
export function mcpAuthFailure(error: unknown) {
  const unavailable = error instanceof SetupError;
  return Response.json({ error: unavailable ? 'The Remy connection is not configured yet.' : 'Connect your Remy Mux owner account to continue.' }, { status: unavailable ? 503 : 401, headers: { 'Cache-Control': 'private, no-store', ...(unavailable ? {} : { 'WWW-Authenticate': mcpChallenge() }) } });
}
export function assertMcpEnabled() { if (process.env.REMY_MCP_ENABLED !== 'true') throw new SetupError('The Remy connection is not enabled yet.'); }

export async function authorizeMcp(request: Request): Promise<McpIdentity> {
  assertMcpEnabled();
  const match = /^Bearer (remy_at_[A-Za-z0-9_-]{43})$/i.exec(request.headers.get('authorization') ?? '');
  if (!match) throw new McpAuthorizationError();
  const admin = createAdminClient();
  // Only an opaque Remy credential is accepted; a Supabase JWT/service key can
  // never authenticate here. Validation and guard capture share one owner lock.
  const { data: active, error } = await admin.rpc('remy_mcp_authorize_token', { p_hash: mcpTokenHash(match[1]), p_resource: mcpResource() });
  if (error || !active || !UUID.test(active.owner) || !UUID.test(active.client_id) || !Array.isArray(active.scopes) || !MCP_AUTH_SCOPES.every(scope => active.scopes.includes(scope)) || active.guard?.provider !== 'remy-mcp' || active.guard.disabled || !Number.isSafeInteger(active.guard?.generation) || !Number.isSafeInteger(active.guard?.version)) throw new McpAuthorizationError();
  const { data: identity, error: userError } = await admin.auth.admin.getUserById(active.owner);
  const user = identity.user;
  if (userError || !user || user.id !== active.owner || !user.email_confirmed_at || !isAllowedEmail(user.email) || user.deleted_at || (user.banned_until && (!Number.isFinite(Date.parse(user.banned_until)) || Date.parse(user.banned_until) > Date.now()))) throw new McpAuthorizationError();
  return { userId: user.id, email: user.email!, fullName: typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null, clientId: active.client_id, scopes: active.scopes, guard: active.guard as OperationGuard };
}
