import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { listAccessRequests } from '@/lib/access-requests';
import { createClient } from '@/lib/supabase/server';
import { isAllowedEmail } from '@/lib/supabase/config';
import SignOut from '@/app/access-pending/sign-out';
import RequestList from './request-list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Access requests · Remy Mux', robots: { index: false, follow: false } };

export default async function AccessRequests({ searchParams }: { searchParams: Promise<{ offset?: string }> }) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;
  if (error || !user || !user.email_confirmed_at) redirect('/login');
  if (!isAllowedEmail(user.email)) redirect('/access-pending');
  const query = await searchParams;
  const suppliedOffset = Number(query.offset || 0);
  const offset = Number.isSafeInteger(suppliedOffset) && suppliedOffset >= 0 && suppliedOffset <= 100_000 ? suppliedOffset : 0;
  let result: Awaited<ReturnType<typeof listAccessRequests>> | null = null;
  try { result = await listAccessRequests({ userId: user.id, email: user.email!, fullName: null }, offset); } catch { /* Render a non-sensitive operational error. */ }
  return <main className="page-content" style={{ maxWidth: 820, paddingTop: 40 }}>
    <Brand />
    <h1 style={{ fontSize: 30, fontWeight: 600, letterSpacing: -1 }}>Access requests</h1>
    <p style={{ color: '#64716a', lineHeight: 1.7 }}>People who signed in with a verified Google account appear here. All requests are pending. This page can retry a notification; it does not grant journal access.</p>
    {!result ? <p role="alert">Access requests could not be loaded. Refresh this page to try again.</p> : <>
      {!result.emailConfigured && <p className="notice" role="status">Email setup is incomplete. Requests are saved here while notifications wait.</p>}
      <RequestList requests={result.requests} emailConfigured={result.emailConfigured} />
      <nav aria-label="Request pages" style={{ display: 'flex', gap: 20, margin: '22px 0' }}>
        {offset > 0 && <Link href={`/access-requests?offset=${Math.max(0, offset - 50)}`}>← Newer requests</Link>}
        {result.hasMore && <Link href={`/access-requests?offset=${offset + 50}`}>Older requests →</Link>}
      </nav>
    </>}
    <p style={{ display: 'flex', gap: 20, margin: '22px 0' }}><Link href="/">← Journal</Link><Link href="/privacy">Privacy policy</Link></p>
    <SignOut />
  </main>;
}
