'use client';

import { useState } from 'react';

export default function SignOut() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function signOut() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/auth/signout', { method: 'POST' });
      if (!response.ok) throw new Error();
      window.location.replace('/login');
    } catch { setError('Could not sign out. Please try again.'); setBusy(false); }
  }
  return <div><button className="quiet-button" type="button" disabled={busy} onClick={signOut}>{busy ? 'Signing out…' : 'Sign out'}</button>{error && <p role="alert">{error}</p>}</div>;
}
