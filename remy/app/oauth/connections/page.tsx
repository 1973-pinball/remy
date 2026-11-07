import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { authorize } from '@/lib/http';
import { appOrigin } from '@/lib/supabase/config';
import { createAdminClient } from '@/lib/supabase/admin';
export const dynamic = 'force-dynamic';
export default async function Connections({ searchParams }: { searchParams: Promise<{ revoked?: string; }>; }) {
  let user;
  try { user = await authorize(new Request(`${appOrigin()}/oauth/connections`)); } catch { redirect('/login'); }
  const query = await searchParams, db = createAdminClient();
  const { data: clients, error } = await db.from('remy_mcp_clients').select('client_id,name').eq('owner', user.userId);
  const { data: grants, error: grantError } = await db.from('remy_mcp_grants').select('client_id,approved_at,revoked_at').eq('owner', user.userId);
  return <main className="page-content oauth-page" style={{ maxWidth: 660, paddingTop: 50 }}><Brand /><section className="card"><h1>Connected apps</h1>
    <p>Manage apps that can read and update your food journal and read running, recovery, sleep, and weight summaries.</p>
    {query.revoked && <p role="status">Remy access has been revoked.</p>}
    {error || grantError ? <p role="alert">Connections could not be loaded. Try again.</p> : !grants?.length ? <p>No connected apps yet.</p> : grants.map(grant => <div key={grant.client_id} style={{ borderTop: '1px solid var(--border)', padding: '18px 0' }}>
      <strong>{clients?.find(client => client.client_id === grant.client_id)?.name ?? 'Remy connection'}</strong><p>{grant.revoked_at ? 'Access revoked' : 'Permission approved to read and update food history, and read training, recovery, sleep, and weight summaries. Connections expire after 30 days.'}</p>
      {!grant.revoked_at && <form action="/oauth/revoke" method="post"><input type="hidden" name="client_id" value={grant.client_id} /><button className="quiet-button">Revoke access</button></form>}
    </div>)}
    <Link href="/">Back to your journal</Link>
  </section></main>;
}
