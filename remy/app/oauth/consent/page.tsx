import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { authorize } from '@/lib/http';
import { appOrigin } from '@/lib/supabase/config';
import { assertMcpEnabled } from '@/lib/mcp-auth';
import { authorizationId, pendingAuthorization } from '@/lib/mcp-consent';

export const dynamic = 'force-dynamic';
export default async function Consent({ searchParams }: { searchParams: Promise<{ authorization_id?: string; }>; }) {
  const query = await searchParams;
  let user;
  let id: string;
  try { assertMcpEnabled(); id = authorizationId(query.authorization_id); }
  catch { return <main className="page-content"><section className="card"><h1>Connection unavailable</h1><p>Start a new Remy connection, or finish the server setup first.</p><Link href="/">Back to Remy</Link></section></main>; }
  try { user = await authorize(new Request(`${appOrigin()}/oauth/consent`)); }
  catch (error) {
    if ((error as { status?: number; }).status === 401) redirect(`/oauth/start?authorization_id=${encodeURIComponent(id)}`);
    return <main className="page-content"><section className="card"><h1>Owner account required</h1><p>Only the verified owner can connect this private journal.</p><Link href="/login">Sign in to Remy</Link></section></main>;
  }
  let pending;
  try {
    pending = await pendingAuthorization(user.userId, id);
  } catch { return <main className="page-content"><section className="card"><h1>Connection needs review</h1><p>This request is not approved for your journal. Return to the app and reconnect, or review existing access.</p><Link href="/oauth/connections">Review connected apps</Link></section></main>; }
  const { client, details } = pending;
  return <main className="page-content oauth-page" style={{ maxWidth: 660, paddingTop: 50 }}><Brand /><section className="card">
    <p className="eyebrow">CONNECT YOUR JOURNAL</p><h1>Connect {client.name} to Remy?</h1>
    <p>Signed in as {user.email}.</p>
    <p>This connection can read your food journal, nutrition totals, and summaries of your running, recovery, sleep, and weight. It can save or correct meals you ask it to log. It cannot access provider credentials, raw health exports, or private photo files.</p>
    <p>Your profile name and stable account ID identify this connection. Requested permissions: <strong>{details.scopes.join(', ')}</strong>.</p>
    <p>Approval does not let Remy read your ChatGPT conversations. Only information you send using the connected tools reaches your journal.</p>
    <form action="/oauth/decision" method="post" style={{ display: 'flex', gap: 12, marginTop: 24 }}>
      <input type="hidden" name="authorization_id" value={id} />
      <button className="primary-button" name="decision" value="approve">Connect Remy</button>
      <button className="quiet-button" name="decision" value="deny">Cancel</button>
    </form>
    <p style={{ marginTop: 20, fontSize: 13 }}>You can revoke access at any time in <Link href="/oauth/connections">Connected apps</Link>. For security, reconnect after 30 days.</p>
  </section></main>;
}
