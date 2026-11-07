import { authorize, failure } from '@/lib/http';
import { appOrigin } from '@/lib/supabase/config';
import { createAdminClient } from '@/lib/supabase/admin';
import { authorizationId } from '@/lib/mcp-consent';
import { oauthForm } from '@/lib/mcp-oauth';
export async function POST(request: Request) {
  try {
    const user = await authorize(request, true);
    const form = await oauthForm(request);
    if (form.getAll('client_id').length !== 1) throw new Error('Invalid connection request.');
    const clientId = authorizationId(form.get('client_id'));
    const { error } = await createAdminClient().rpc('remy_mcp_revoke_grant', { p_owner: user.userId, p_client: clientId });
    if (error) throw new Error('Access could not be revoked. Try again.');
    return new Response(null, { status: 303, headers: { Location: `${appOrigin()}/oauth/connections?revoked=1`, 'Cache-Control': 'private, no-store' } });
  } catch (error) { return failure(error); }
}
