import Link from 'next/link';
import { Brand } from '@/components/brand';
import { authSetupMessage } from '@/lib/supabase/config';
import { googleSignInAvailability } from '@/lib/supabase/providers';
import LoginForm from './sign-in-form';

export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const setup = authSetupMessage();
  const query = await searchParams;
  const googleAvailability = setup ? 'unavailable' : await googleSignInAvailability();
  return <main className="page-content" style={{ maxWidth: 620, paddingTop: 70 }}>
    <Brand />
    <section className="card">
      <p className="eyebrow">YOUR PRIVATE JOURNAL</p>
      <h1 style={{ fontSize: 30, fontWeight: 600, letterSpacing: -1 }}>Fuel your next run.</h1>
      <p style={{ color: '#64716a', lineHeight: 1.6 }}>Sign in to bring your nutrition history, training and recovery together. Use your Google account or a one-time email link.</p>
      {setup ? <div role="status" className="notice" style={{ display: 'block', lineHeight: 1.7 }}>
        <strong>Private storage setup is pending.</strong><p>{setup}</p>
        <p>Your journal will be available after the owner connects Supabase.</p>
      </div> : <LoginForm errorCode={query.error} googleAvailability={googleAvailability} />}
    </section>
    <p style={{ fontSize: 13, marginTop: 22, color: '#64716a', display: 'flex', gap: 20, flexWrap: 'wrap' }}><Link href="/">← Back to Remy Mux</Link><Link href="/privacy">Privacy policy</Link></p>
  </main>;
}
