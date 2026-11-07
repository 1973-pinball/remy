import { authorize, failure } from '@/lib/http';
import { appOrigin } from '@/lib/supabase/config';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertMcpEnabled, mcpIssuer, mcpTokenHash } from '@/lib/mcp-auth';
import { authorizationId, pendingAuthorization } from '@/lib/mcp-consent';
import { opaqueToken, oauthForm } from '@/lib/mcp-oauth';

export async function POST(request: Request) {
  try {
    assertMcpEnabled();
    const user = await authorize(request, true);
    const form = await oauthForm(request), id = authorizationId(form.get('authorization_id')), decision = form.get('decision');
    if (form.getAll('authorization_id').length !== 1 || form.getAll('decision').length !== 1) throw new Error('Invalid connection request.');
    if (!['approve', 'deny'].includes(String(decision))) throw new Error('Choose whether to connect this app.');
    const { details } = await pendingAuthorization(user.userId, id);
    const code = opaqueToken('ac');
    const { data, error } = await createAdminClient().rpc('remy_mcp_decide_authorization', { p_owner: user.userId, p_id: id, p_approve: decision === 'approve', p_code_hash: mcpTokenHash(code) });
    if (error || !data || data.redirect_uri !== details.redirect_uri || data.state !== details.state) throw new Error('The connection could not finish. Start connecting again.');
    const destination = new URL(data.redirect_uri);
    destination.searchParams.set('state', data.state);
    destination.searchParams.set('iss', mcpIssuer());
    destination.searchParams.set(decision === 'approve' ? 'code' : 'error', decision === 'approve' ? code : 'access_denied');
    return new Response(null, { status: 303, headers: { Location: destination.href, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch (error) {
    if ((error as { status?: number; }).status === 401) return Response.redirect(`${appOrigin()}/login`, 303);
    return failure(error);
  }
}
