import 'server-only';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createAdminClient } from './supabase/admin';
import { appOrigin } from './supabase/config';
import { assertMcpEnabled, MCP_AUTH_SCOPES, mcpIssuer, mcpResource, mcpTokenHash, UUID } from './mcp-auth';

export function oauthMetadata() {
  const origin = mcpIssuer();
  return { issuer: origin, authorization_endpoint: `${origin}/oauth/authorize`, token_endpoint: `${origin}/oauth/token`, revocation_endpoint: `${origin}/oauth/revoke-token`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], scopes_supported: [...MCP_AUTH_SCOPES], authorization_response_iss_parameter_supported: true };
}
export class OAuthError extends Error { constructor(readonly code: string, readonly status = 400) { super(code); } }
export function oauthFailure(error: unknown) {
  return oauthJson({ error: error instanceof OAuthError ? error.code : 'server_error' }, error instanceof OAuthError ? error.status : 503);
}
export function oauthJson(data: unknown, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache', 'Access-Control-Allow-Origin': '*' } }); }
function one(params: URLSearchParams, name: string, required = true) {
  const values = params.getAll(name);
  if (values.length > 1 || (required && (values.length !== 1 || !values[0]))) throw new OAuthError('invalid_request');
  return values[0] ?? '';
}
export async function oauthForm(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded' || Number(request.headers.get('content-length') ?? 0) > 8192 || !request.body) throw new OAuthError('invalid_request');
  const reader = request.body.getReader(), decoder = new TextDecoder();
  let text = '', bytes = 0;
  try {
    for (; ;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 8192) { await reader.cancel(); throw new OAuthError('invalid_request'); }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  return new URLSearchParams(text);
}
function clientId(params: URLSearchParams) {
  const id = one(params, 'client_id');
  if (!UUID.test(id) || params.has('client_secret')) throw new OAuthError('invalid_client');
  return id;
}
function resource(params: URLSearchParams) { const value = one(params, 'resource'); if (value !== mcpResource()) throw new OAuthError('invalid_target'); return value; }
function scopes(params: URLSearchParams) {
  const parsed = one(params, 'scope').split(/\s+/).filter(Boolean);
  if (new Set(parsed).size !== parsed.length || !MCP_AUTH_SCOPES.every(scope => parsed.includes(scope)) || parsed.some(scope => !(MCP_AUTH_SCOPES as readonly string[]).includes(scope))) throw new OAuthError('invalid_scope');
  return parsed;
}
export function opaqueToken(kind: 'ac' | 'at' | 'rt') { return `remy_${kind}_${randomBytes(32).toString('base64url')}`; }
export function pkceChallenge(verifier: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new OAuthError('invalid_grant');
  return createHash('sha256').update(verifier).digest('base64url');
}
export async function beginOAuth(request: Request) {
  assertMcpEnabled();
  const params = new URL(request.url).searchParams;
  const id = clientId(params), target = resource(params), requested = scopes(params), state = one(params, 'state'), challenge = one(params, 'code_challenge'), redirect = one(params, 'redirect_uri');
  if (one(params, 'response_type') !== 'code') throw new OAuthError('unsupported_response_type');
  if (one(params, 'code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || state.length > 512 || redirect.length > 2048) throw new OAuthError('invalid_request');
  let destination: URL; try { destination = new URL(redirect); } catch { throw new OAuthError('invalid_request'); }
  if (destination.protocol !== 'https:' || destination.username || destination.password || destination.hash) throw new OAuthError('invalid_request');
  const authorizationId = randomUUID();
  const { error } = await createAdminClient().rpc('remy_mcp_begin_authorization', { p_id: authorizationId, p_client: id, p_redirect: redirect, p_resource: target, p_scopes: requested, p_state: state, p_challenge: challenge });
  if (error) throw new OAuthError(error.message?.includes('RATE_LIMIT') ? 'temporarily_unavailable' : 'invalid_request', error.message?.includes('RATE_LIMIT') ? 429 : 400);
  return new Response(null, { status: 303, headers: { Location: `${appOrigin()}/oauth/consent?authorization_id=${authorizationId}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
export async function exchangeOAuth(request: Request) {
  assertMcpEnabled();
  if (request.headers.has('authorization')) throw new OAuthError('invalid_client');
  const params = await oauthForm(request), client = clientId(params), target = resource(params), grant = one(params, 'grant_type');
  const access = opaqueToken('at'), refresh = opaqueToken('rt');
  const db = createAdminClient();
  let result;
  if (grant === 'authorization_code') {
    const code = one(params, 'code'); if (!/^remy_ac_[A-Za-z0-9_-]{43}$/.test(code)) throw new OAuthError('invalid_grant');
    const challenge = pkceChallenge(one(params, 'code_verifier'));
    result = await db.rpc('remy_mcp_exchange_code', { p_client: client, p_code_hash: mcpTokenHash(code), p_redirect: one(params, 'redirect_uri'), p_resource: target, p_challenge: challenge, p_access_hash: mcpTokenHash(access), p_refresh_hash: mcpTokenHash(refresh), p_family: randomUUID() });
  } else if (grant === 'refresh_token') {
    const prior = one(params, 'refresh_token'); if (!/^remy_rt_[A-Za-z0-9_-]{43}$/.test(prior)) throw new OAuthError('invalid_grant');
    if (params.has('scope')) scopes(params); // No widening or silent scope changes.
    result = await db.rpc('remy_mcp_refresh_token', { p_client: client, p_refresh_hash: mcpTokenHash(prior), p_resource: target, p_access_hash: mcpTokenHash(access), p_next_refresh_hash: mcpTokenHash(refresh) });
  } else throw new OAuthError('unsupported_grant_type');
  if (result.error) throw new OAuthError('invalid_grant');
  if (!result.data || result.data.error) throw new OAuthError('invalid_grant');
  return oauthJson({ access_token: access, token_type: 'Bearer', expires_in: result.data.expires_in, refresh_token: refresh, scope: result.data.scope });
}
export async function revokeOAuth(request: Request) {
  assertMcpEnabled();
  if (request.headers.has('authorization')) throw new OAuthError('invalid_client');
  const params = await oauthForm(request), client = clientId(params), token = one(params, 'token');
  if (/^remy_(?:at|rt)_[A-Za-z0-9_-]{43}$/.test(token)) {
    const { error } = await createAdminClient().rpc('remy_mcp_revoke_token', { p_client: client, p_hash: mcpTokenHash(token) });
    if (error) throw new OAuthError('server_error', 503);
  }
  return oauthJson({});
}
