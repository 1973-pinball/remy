'use client';

import { useState, type FormEvent } from 'react';

export default function LoginForm({ invalidLink }: { invalidLink: boolean }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(invalidLink ? 'This link could not sign you in. Request a new link and open the newest email in the same browser and on the same device you use here.' : '');

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

  return sent ? <div role="status" style={{ lineHeight: 1.7 }}><strong>Check your inbox.</strong><p>If this is the journal owner’s email, a sign-in link is on its way. Open the newest link in the same browser and on the same device you used here. If your email opens another browser, copy the link into this one.</p><button className="text-button" onClick={() => setSent(false)}>Use another email</button></div> : <form onSubmit={submit} style={{ display: 'grid', gap: 14, marginTop: 26 }}>
    <label htmlFor="owner-email" style={{ fontSize: 14, fontWeight: 600 }}>Email address</label>
    <input id="owner-email" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" style={{ padding: '13px 14px', border: '1px solid #dbe2dc', borderRadius: 8, font: 'inherit', width: '100%' }} />
    {error && <p role="alert" style={{ color: '#a42731', fontSize: 14, lineHeight: 1.5, margin: 0 }}>{error}</p>}
    <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Sending link…' : 'Email me a sign-in link'}</button>
    <p style={{ fontSize: 12, color: '#718075', lineHeight: 1.5 }}>Access is limited to the journal owner’s email.</p>
  </form>;
}
