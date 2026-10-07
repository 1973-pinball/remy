import Link from 'next/link';
import { authSetupMessage } from '@/lib/supabase/config';
import LoginForm from './sign-in-form';

export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const setup = authSetupMessage();
  const query = await searchParams;
  return <main className="page-content" style={{ maxWidth: 620, paddingTop: 70 }}>
    <Link href="/" className="brand" aria-label="Remy Mux home"><span className="brand-mark" aria-hidden="true">r</span><span className="brand-name">Remy Mux<span className="brand-period">.</span></span></Link>
    <section className="card">
      <p className="eyebrow">YOUR PRIVATE JOURNAL</p>
      <h1 style={{ fontSize: 30, fontWeight: 600, letterSpacing: -1 }}>Fuel your next run.</h1>
      <p style={{ color: '#64716a', lineHeight: 1.6 }}>Sign in to bring your nutrition history, training and recovery together. We’ll email you a one-time sign-in link.</p>
      {setup ? <div role="status" className="notice" style={{ display: 'block', lineHeight: 1.7 }}>
        <strong>Private storage setup is pending.</strong><p>{setup}</p>
        <p>Your journal will be available after the owner connects Supabase.</p>
      </div> : <LoginForm invalidLink={query.error === 'invalid-link'} />}
    </section>
    <p style={{ fontSize: 13, marginTop: 22, color: '#64716a' }}><Link href="/">← Back to Remy Mux</Link></p>
  </main>;
}
