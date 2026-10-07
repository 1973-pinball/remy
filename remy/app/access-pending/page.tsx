import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { ownAccessRequest } from '@/lib/access-requests';
import { isAllowedEmail } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import SignOut from './sign-out';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Access request · Remy Mux', robots: { index: false, follow: false } };

export default async function AccessPending() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;
  if (error || !user || !user.email_confirmed_at) redirect('/login');
  if (isAllowedEmail(user.email)) redirect('/access-requests');
  if (!user.identities?.some(identity => identity.provider === 'google')) redirect('/login');
  let request: Awaited<ReturnType<typeof ownAccessRequest>> = null;
  let unavailable = false;
  try { request = await ownAccessRequest(user); } catch { unavailable = true; }
  return <main className="page-content" style={{ maxWidth: 620, paddingTop: 70 }}>
    <Brand />
    <section className="card" style={{ lineHeight: 1.7 }}>
      <p className="eyebrow">ACCESS REQUEST</p>
      <h1 style={{ fontSize: 30, fontWeight: 600, letterSpacing: -1 }}>{request ? 'Your request is saved.' : unavailable ? 'Request status unavailable' : 'No request found yet'}</h1>
      {request ? <>
        <p>Your Google account has requested access. Access is pending; signing in has not granted access to the private journal.</p>
        <p role="status">{request.notification === 'sent' ? 'The notification has been submitted to the email service for the owner.' : 'Email notification is still pending. Your saved request is visible to the owner; you do not need to sign in again.'}</p>
      </> : <p role="status">{unavailable ? 'We could not load your request status. Refresh this page to try again.' : 'Continue with Google from the sign-in page to submit an access request.'}</p>}
      <SignOut />
    </section>
    <p style={{ fontSize: 13, marginTop: 22, display: 'flex', gap: 20 }}><Link href="/login">Sign-in page</Link><Link href="/privacy">Privacy policy</Link></p>
  </main>;
}
