'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { GoogleSignInAvailability } from '@/lib/supabase/providers';

export function signInErrorMessage(code: string | undefined) {
  switch (code) {
    case 'invalid-link': return 'This link could not sign you in. Request a new link and open the newest email in the same browser and on the same device you use here.';
    case 'google-cancelled': return 'Google sign-in was cancelled or access was declined. You can try again or use an email link.';
    case 'google-unavailable': return 'Google sign-in is not available yet. Try again after setup is complete, or use an email link.';
    case 'google-failed': return 'Google sign-in could not finish. Try again in the same browser, or open Remy Mux in Chrome or Edge and start there.';
    case 'owner-only': return 'This journal is private. Sign in with the journal owner’s verified account.';
    case 'access-request-failed': return 'Your access request could not be saved. Try Google sign-in again. The journal remains private.';
    default: return '';
  }
}

export default function LoginForm({ errorCode, googleAvailability }: { errorCode?: string; googleAvailability: GoogleSignInAvailability }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(signInErrorMessage(errorCode));
  useEffect(() => {
    const resume = () => setGoogleBusy(false);
    window.addEventListener('pageshow', resume);
    return () => window.removeEventListener('pageshow', resume);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const response = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not send a sign-in link.');
      setSent(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not send a sign-in link.'); }
    finally { setBusy(false); }
  }

  return <div style={{ display: 'grid', gap: 18, marginTop: 26 }}>
    {error && <p role="alert" style={{ color: '#a42731', fontSize: 14, lineHeight: 1.5, margin: 0 }}>{error}</p>}
    <div>
      <form action="/auth/google" method="post" onSubmit={() => setGoogleBusy(true)}>
        <button type="submit" className="primary-button" disabled={googleAvailability !== 'enabled' || googleBusy || busy} style={{ width: '100%', justifyContent: 'center' }}>
          {googleBusy ? 'Opening Google…' : 'Continue with Google'}
        </button>
      </form>
      {googleAvailability !== 'enabled' && <p role="status" style={{ fontSize: 13, color: '#64716a', lineHeight: 1.5, margin: '10px 0 0' }}>
        {googleAvailability === 'disabled' ? 'Google sign-in is waiting for provider setup. You can use an email link below.' : 'Google sign-in could not be checked. Reload this page to try again, or use an email link below.'}
      </p>}
      <p style={{ fontSize: 13, color: '#64716a', lineHeight: 1.5, margin: '10px 0 0' }}>New Google accounts send the owner an access request with your name and email. Signing in does not grant access to the private journal.</p>
    </div>
    <p style={{ fontSize: 13, color: '#718075', margin: 0 }}>Or sign in by email</p>
    {sent ? <div role="status" style={{ lineHeight: 1.7 }}><strong>Check your inbox.</strong><p>If this is the journal owner’s email, a sign-in link is on its way. Open the newest link in the same browser and on the same device you used here. If your email opens another browser, copy the link into this one.</p><button className="text-button" onClick={() => setSent(false)}>Use another email</button></div> : <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
      <label htmlFor="owner-email" style={{ fontSize: 14, fontWeight: 600 }}>Email address</label>
      <input id="owner-email" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" style={{ padding: '13px 14px', border: '1px solid #dbe2dc', borderRadius: 8, font: 'inherit', width: '100%' }} />
      <button type="submit" className="quiet-button" disabled={busy || googleBusy}>{busy ? 'Sending link…' : 'Email me a sign-in link'}</button>
    </form>}
    <p style={{ fontSize: 12, color: '#718075', lineHeight: 1.5, margin: 0 }}>Email sign-in is available to the journal owner.</p>
  </div>;
}
