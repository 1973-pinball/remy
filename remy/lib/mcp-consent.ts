import 'server-only';
import { createAdminClient } from './supabase/admin';
import { mcpResource, UUID } from './mcp-auth';
export type McpClient = { client_id: string; owner: string; name: string; resource: string; redirect_uris: string[]; enabled: boolean; };
export type McpAuthorization = { id: string; client_id: string; redirect_uri: string; resource: string; scopes: string[]; state: string; challenge: string; expires_at: string; used_at: string | null; };
export function authorizationId(value: unknown) {
  if (typeof value !== 'string' || !UUID.test(value)) throw Object.assign(new Error('This connection request is invalid or expired. Start connecting again.'), { status: 400 });
  return value;
}
export async function pendingAuthorization(owner: string, id: string) {
  const db = createAdminClient();
  const { data: raw, error } = await db.from('remy_mcp_authorizations').select('*').eq('id', authorizationId(id)).maybeSingle();
  const details = raw as McpAuthorization | null;
  if (error || !details || details.used_at || Date.parse(details.expires_at) <= Date.now()) throw new Error('This connection request expired. Start connecting again.');
  const { data, error: clientError } = await db.from('remy_mcp_clients').select('*').eq('client_id', details.client_id).eq('owner', owner).eq('enabled', true).maybeSingle();
  const client = data as McpClient | null;
  if (clientError || !client || client.resource !== mcpResource() || details.resource !== client.resource || !client.redirect_uris.includes(details.redirect_uri)) throw new Error('This client is not registered for your Remy journal.');
  return { client, details };
}
