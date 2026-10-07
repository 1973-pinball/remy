'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowUpRight, CheckCircle2, Download, Link2, LoaderCircle, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { addDays, ofKind, profileOf, summarize, weeklyTraining, type Entry, type Plan, type Workout } from '@/lib/domain';
import { Field, ProfileForm, type SaveRecord } from './forms';

const decimal = (value: number | null | undefined, digits = 1) => value == null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: digits });
const miles = (meters: number | null | undefined) => meters == null ? 'Distance unknown' : `${decimal(meters / 1609.344)} mi`;
const dateLabel = (date: string | null) => date ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'Date unknown';
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not yet synced';
const sourceLabel = (source: string) => ({ whoop: 'WHOOP', strava: 'Strava', runna: 'Runna', tredict: 'Tredict', manual: 'Manual', fit: 'FIT import' }[source] ?? source);

function Headline({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="stat-card"><span>{label}</span><strong>{value}</strong><p>{note}</p></article>;
}

export function TrainingView({ entries, date, onEdit, onSave }: {
  entries: Entry[]; date: string; onEdit: (entry?: Entry, planned?: boolean) => void; onSave: (record: SaveRecord) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const week = weeklyTraining(entries, date);
  const context = summarize(entries, date);
  const cycles = [...context.recovery].sort((a, b) => b.data.start.localeCompare(a.data.start));
  const recovery = cycles[0];
  const cycleTime = (instant: string | null) => instant ? new Intl.DateTimeFormat('en-US', { timeZone: context.profile.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(instant)) : 'Ongoing';
  const cycleKcal = recovery?.data.scoreState === 'SCORED' && recovery.data.kilojoules != null ? Math.round(recovery.data.kilojoules / 4.184) : null;
  const knownDistances = week.runs.filter(run => run.data.distanceMeters != null);
  const weeklyMiles = knownDistances.length ? knownDistances.reduce((sum, run) => sum + run.data.distanceMeters!, 0) / 1609.344 : null;
  const workouts = ofKind<Workout>(entries, 'workout').filter(run => /run|treadmill/i.test(run.data.sport)).sort((a, b) => b.data.start.localeCompare(a.data.start));
  const plans = ofKind<Plan>(entries, 'plan').filter(plan => plan.localDate && plan.localDate >= week.start && plan.localDate <= addDays(week.end, 7)).sort((a, b) => (a.localDate ?? '').localeCompare(b.localDate ?? ''));

  async function linkRun(plan: Entry<Plan>, value: string) {
    setBusy(plan.id); setError('');
    try {
      await onSave({ id: plan.id, kind: 'plan', localDate: plan.localDate, revision: plan.revision, data: { ...plan.data, completedWorkoutId: value === 'none' ? null : value } });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not link this run.'); }
    finally { setBusy(null); }
  }

  return <>
    <div className="section-heading" style={{ marginTop: 0 }}><h2>{dateLabel(week.start)}–{dateLabel(week.end)}</h2><button className="quiet-button" onClick={() => onEdit(undefined, false)}><Plus size={17} />Add a run</button></div>
    <div className="stat-grid">
      <Headline label="Weekly running" value={weeklyMiles == null ? '—' : `${decimal(weeklyMiles)} mi`} note={week.count ? `${week.count} recorded run${week.count === 1 ? '' : 's'}${week.missingDistance ? ` · ${week.missingDistance} missing distance` : ' · known distance'}` : 'Import or log a completed run'} />
      <Headline label="WHOOP cycle energy" value={cycleKcal == null ? '—' : `${decimal(cycleKcal, 0)} kcal`} note={cycles.length > 1 ? `${cycles.length} overlapping cycles · latest shown` : recovery ? `Estimated · cycle begins ${dateLabel(recovery.localDate)}` : 'No cycle overlaps the selected day'} />
      <Headline label="WHOOP strain" value={decimal(recovery?.data.strain)} note={recovery ? 'For the displayed physiological cycle' : 'Connect WHOOP to add exertion context'} />
      <Headline label="Sleep" value={recovery?.data.sleepHours == null ? '—' : `${decimal(recovery.data.sleepHours)} hr`} note={recovery ? 'Sleep linked to the displayed cycle' : 'No sleep history for the selected day'} />
    </div>
    <p className="notice">WHOOP cycles can cross calendar days. Energy is an estimate and is never added automatically to your food target.</p>
    {cycles.length > 1 && <section className="card" style={{ marginBottom: 20 }}>
      <div className="section-heading"><h2>Cycles overlapping {dateLabel(date)}</h2><span>{context.profile.timezone}</span></div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {cycles.map(cycle => {
          const kcal = cycle.data.scoreState === 'SCORED' && cycle.data.kilojoules != null ? Math.round(cycle.data.kilojoules / 4.184) : null;
          return <li id={cycle.id} key={cycle.id} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, padding: '13px 0', borderTop: '1px solid var(--border)', scrollMarginTop: 24 }}><span style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>{cycleTime(cycle.data.start)} → {cycleTime(cycle.data.end)}</span><strong style={{ fontSize: 14, fontWeight: 600 }}>{kcal == null ? 'Energy unavailable' : `${decimal(kcal, 0)} kcal estimated`}</strong></li>;
        })}
      </ul>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Each value covers its full physiological cycle. They are shown separately and are not a calendar-day total.</p>
    </section>}
    {error && <p className="error" role="alert">{error}</p>}
    <section className="card" style={{ marginTop: 10 }}>
      <div className="section-heading"><h2>Your plan, then the run</h2><button className="text-button" onClick={() => onEdit(undefined, true)}><Plus size={16} />Add a planned session</button></div>
      <p className="muted">This week and next. Link a completed run to a prescribed session so nutrition context reflects what’s still ahead.</p>
      {!plans.length ? <div className="empty-block"><span className="empty-icon"><Activity size={20} /></span><h3>Your next session belongs here.</h3><p>Import your Runna calendar or add a session with a date, distance, and intended effort.</p></div> : <div style={{ display: 'grid', gap: 14 }}>
        {plans.map(plan => <article id={plan.id} key={plan.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 18, scrollMarginTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 15 }}><div><span className="eyebrow">{dateLabel(plan.localDate)} · {sourceLabel(plan.source)}</span><h3 style={{ margin: '7px 0', fontWeight: 600 }}>{plan.data.title}</h3><p className="muted">{miles(plan.data.distanceMeters)} · {plan.data.durationSec == null ? 'Duration unknown' : `${decimal(plan.data.durationSec / 60)} min`} · {plan.data.intensity || 'Effort unspecified'}</p></div>{plan.data.cancelled ? <span className="pill">Cancelled</span> : plan.data.completedWorkoutId ? <span className="pill"><CheckCircle2 size={12} style={{ marginRight: 5 }} />Linked</span> : <span className="pill">Planned</span>}</div>
          {plan.data.notes && <details style={{ margin: '12px 0', fontSize: 14 }}><summary>{plan.source === 'runna' ? 'Original Runna prescription' : 'Session notes'}</summary><p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, color: 'var(--muted-foreground)' }}>{plan.data.notes}</p></details>}
          {plan.source === 'runna' && <p className="muted" style={{ fontSize: 12 }}>Runna’s date and prescription remain the source plan. Linking a run updates your Remy journal only.</p>}
          {!plan.data.cancelled && <Field label="Completed run"><Select disabled={busy === plan.id} value={plan.data.completedWorkoutId ?? 'none'} onValueChange={value => void linkRun(plan, value)}><SelectTrigger className="w-full" aria-label={`Completed run for ${plan.data.title}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Not linked yet</SelectItem>{workouts.map(run => <SelectItem key={run.id} value={run.id}>{dateLabel(run.localDate)} · {run.data.title} · {miles(run.data.distanceMeters)}</SelectItem>)}</SelectContent></Select></Field>}
          {plan.source !== 'runna' && <button className="text-button" onClick={() => onEdit(plan as unknown as Entry, true)}>Edit session</button>}
        </article>)}
      </div>}
    </section>
    <section className="card" style={{ marginTop: 20 }}>
      <div className="section-heading"><h2>Completed this week</h2><span>{week.count} recorded</span></div>
      {!week.runs.length ? <p className="muted">No completed runs recorded for this week. This does not mean you took a rest week.</p> : week.runs.map(run => <article id={run.id} key={run.id} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 15, padding: '15px 0', borderTop: '1px solid var(--border)', scrollMarginTop: 24 }}><div><strong style={{ fontSize: 15, fontWeight: 600 }}>{run.data.title}</strong><p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>{dateLabel(run.localDate)} · {sourceLabel(run.source)} · {miles(run.data.distanceMeters)} · {run.data.durationSec == null ? 'Time unknown' : `${decimal(run.data.durationSec / 60)} min`}{run.data.calories == null ? '' : ` · ${decimal(run.data.calories, 0)} kcal estimated`}</p></div><button className="text-button" onClick={() => onEdit(run as unknown as Entry, false)}>Review run <ArrowUpRight size={15} /></button></article>)}
    </section>
  </>;
}

type Provider = 'whoop' | 'strava' | 'runna' | 'tredict';
type ConnectionData = { provider: Provider; disconnected?: boolean; authorized?: boolean; lastSuccess?: string | null; lastAttempt?: string | null; earliest?: string | null; latest?: string | null; count?: number; complete?: boolean; error?: string | null; coverageNote?: string; missingFields?: string[] };
type ConnectionState = { configured: Partial<Record<Provider, boolean>>; authorized: Partial<Record<Provider, boolean>>; statuses: Entry<ConnectionData>[]; configurationErrors?: Partial<Record<Provider, string>> };
const sources: { id: Provider; name: string; summary: string }[] = [
  { id: 'whoop', name: 'WHOOP', summary: 'Cycle energy, exertion, recovery and sleep to put nutrition in context.' },
  { id: 'strava', name: 'Strava', summary: 'Weekly mileage and completed runs. Your detailed activity analysis stays in Strava.' },
  { id: 'runna', name: 'Runna', summary: 'The sessions ahead, with their original prescriptions preserved.' },
  { id: 'tredict', name: 'Tredict', summary: 'Optional running history through your personal activity-read token.' },
];

export function ConnectionsView({ demo, onImport, onRefresh }: { demo: boolean; onImport: () => void; onRefresh: () => Promise<void> }) {
  const [state, setState] = useState<ConnectionState | null>(null);
  const [loading, setLoading] = useState(!demo);
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [credentialFor, setCredentialFor] = useState<Provider | null>(null);
  const [credential, setCredential] = useState('');

  const load = useCallback(async () => {
    if (demo) { setLoading(false); return; }
    setLoading(true);
    try {
      const response = await fetch('/api/connections', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not read connections.');
      setState(payload); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not read connections.'); }
    finally { setLoading(false); }
  }, [demo]);
  useEffect(() => { void load(); }, [load]);

  async function action(source: Provider, name: 'sync' | 'disconnect' | 'credential' | 'enable') {
    if (demo) return;
    setBusy(source); setError(''); setNotice('');
    try {
      const response = await fetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, action: name, ...(name === 'credential' ? { value: credential } : {}) }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'The connection could not be updated.');
      if (name === 'credential') { setCredential(''); setCredentialFor(null); }
      await load(); await onRefresh();
      setNotice(name === 'disconnect' ? `${sourceLabel(source)} disconnected. Previously imported history remains in your journal.` : name === 'credential' ? 'Connection saved. Select Sync now to retrieve available records.' : `${sourceLabel(source)}: ${payload.count ?? 0} records processed.${payload.complete === false ? ' Some history remains incomplete; review source coverage below.' : ''}`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'The connection could not be updated.';
      await load(); setError(message);
    } finally { setBusy(null); }
  }

  return <>
    <div className="section-heading" style={{ marginTop: 0 }}><h2>Nutrition and training sources</h2><button className="quiet-button" onClick={onImport}><Upload size={17} />Import history</button></div>
    {demo && <p className="notice"><span className="pill">Demo</span>Connections are a preview. Sign in to connect your own accounts.</p>}
    {error && <div role="alert" className="error" style={{ marginBottom: 18 }}>{error} {!demo && <button className="text-button" onClick={() => void load()}>Retry</button>}</div>}
    {notice && <p role="status" className="notice">{notice}</p>}
    <section className="card" style={{ marginBottom: 20 }}><div className="section-heading"><h2>REMY nutrition history</h2><span className="pill">Reviewed import</span></div><p className="muted">Import an exported ChatGPT conversation, a pasted REMY transcript, or structured meals. Review portions, dates and ETL contributions before they enter your journal.</p><button className="text-button" onClick={onImport}>Review a nutrition import <ArrowUpRight size={16} /></button></section>
    {loading && <p className="notice" role="status"><LoaderCircle size={17} className="animate-spin" />Checking source status…</p>}
    <div style={{ display: 'grid', gap: 18 }}>
      {sources.map(source => {
        const status = state?.statuses.find(row => row.data.provider === source.id)?.data;
        const configurationError = state?.configurationErrors?.[source.id];
        const ready = state?.configured[source.id] === true;
        const authorized = state?.authorized[source.id] === true;
        const active = authorized && status?.disconnected !== true;
        const disabled = demo || busy !== null || loading;
        const oauth = source.id === 'whoop' || source.id === 'strava';
        return <section className="card" key={source.id}>
          <div className="section-heading"><h2>{source.name}</h2><span className="pill">{demo ? 'Not connected' : configurationError ? 'Needs attention' : status?.disconnected ? 'Disconnected' : status?.error ? 'Needs attention' : active ? 'Connected' : 'Not connected'}</span></div>
          <p className="muted">{source.summary}</p>
          {configurationError && <p className="error" role="alert">{configurationError} {oauth ? `Use Connect ${source.name} to replace the saved authorization.` : source.id === 'runna' ? 'Add the private calendar feed again to replace the saved connection.' : 'Add your personal token again to replace the saved connection.'}</p>}
          {status && <div style={{ fontSize: 13, lineHeight: 1.7, margin: '15px 0', color: 'var(--muted-foreground)' }}><div>Last successful sync: {timestamp(status.lastSuccess)}</div>{status.earliest && status.latest && <div>Observed history: {dateLabel(status.earliest)}–{dateLabel(status.latest)}{typeof status.count === 'number' ? ` · ${status.count} records in last sync` : ''}</div>}{status.coverageNote && <div>{status.coverageNote}</div>}{status.missingFields?.length ? <div>Unavailable: {status.missingFields.join(', ')}.</div> : null}{status.complete === false && <div>Coverage is partial. Missing records are not zero values.</div>}{status.error && <p className="error" role="alert">{status.error}</p>}</div>}
          {!demo && !ready && oauth && <p className="muted" style={{ fontSize: 12 }}>This connection needs the owner’s provider app setup. {source.id === 'strava' ? 'You can import an activities.csv export now.' : 'Add the WHOOP app credentials to enable authorization.'}</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 16 }}>
            {active ? <><button disabled={disabled} className="quiet-button" onClick={() => void action(source.id, 'sync')}><RefreshCw size={15} className={busy === source.id ? 'animate-spin' : ''} />{busy === source.id ? 'Working…' : 'Sync now'}</button><button disabled={disabled} className="text-button" onClick={() => void action(source.id, 'disconnect')}>Disconnect</button></> : oauth && ready && !demo ? <a className="quiet-button" href={source.id === 'whoop' ? '/api/whoop' : '/api/connections?provider=strava&action=connect'}><Link2 size={15} />Connect {source.name}</a> : !oauth ? <button disabled={disabled} className="quiet-button" onClick={() => { setCredentialFor(credentialFor === source.id ? null : source.id); setCredential(''); }}>{source.id === 'runna' ? 'Add calendar feed' : 'Add personal token'}</button> : <button className="quiet-button" disabled><Link2 size={15} />Connect {source.name}</button>}
            {status?.disconnected && ready && authorized && !demo && <button disabled={disabled} className="text-button" onClick={() => void action(source.id, 'enable')}>Enable and sync</button>}
            {(source.id === 'strava' || source.id === 'runna') && <button className="text-button" onClick={onImport}><Upload size={15} />{source.id === 'strava' ? 'Import activities.csv' : 'Import calendar (.ics)'}</button>}
          </div>
          {credentialFor === source.id && <form style={{ marginTop: 18 }} onSubmit={event => { event.preventDefault(); void action(source.id, 'credential'); }}><Field label={source.id === 'runna' ? 'Private Runna calendar feed URL' : 'Tredict personal API token'} hint={source.id === 'runna' ? 'Use the subscription URL supplied by Runna. Import the ICS file if your feed host is unsupported.' : 'Use a personal token with activityRead permission.'}><Input type="password" autoComplete="off" value={credential} onChange={event => setCredential(event.target.value)} required placeholder={source.id === 'runna' ? 'https://…' : 'Personal token'} /></Field><button className="primary-button" disabled={disabled || !credential.trim()}>Save connection</button></form>}
        </section>;
      })}
    </div>
    <p className="notice">Automatic refresh runs once daily after cloud setup. Keep original exports for older history and use source apps for detailed charts.</p>
  </>;
}

export function SettingsView({ entries, demo, onSave, onRefresh }: { entries: Entry[]; demo: boolean; onSave: (record: SaveRecord) => Promise<void>; onRefresh: () => Promise<void> }) {
  const profile = profileOf(entries);
  const profileEntry = entries.find(entry => entry.kind === 'profile' && !entry.deleted);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function deleteJournal() {
    if (demo || confirmation !== 'DELETE MY JOURNAL') return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/journal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteAll', confirmation }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not delete the journal.');
      await onRefresh(); setDeleteOpen(false); setConfirmation(''); setNotice('Your stored journal and saved source connections have been deleted. Your sign-in account remains.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete the journal.'); }
    finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/auth/signout', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not sign out.');
      window.location.assign('/login');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not sign out.'); setBusy(false); }
  }

  return <>
    <div className="section-heading" style={{ marginTop: 0 }}><h2>Your saved preferences</h2>{!demo && <button className="quiet-button" disabled={busy} onClick={() => void signOut()}>Sign out</button>}</div>
    {demo && <p className="notice"><span className="pill">Demo</span>Profile edits apply to the local preview only.</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {error && !deleteOpen && <p className="error" role="alert">{error}</p>}
    <ProfileForm key={profileEntry?.revision ?? 'new'} profile={profile} onSave={async next => { await onSave({ id: profileEntry?.id, kind: 'profile', localDate: null, revision: profileEntry?.revision, data: next }); setNotice('Profile saved. Your confirmed context will inform nutrition references.'); }} />
    <section className="card" style={{ marginTop: 22 }}><div className="section-heading"><h2>Your history, on your terms.</h2><Download size={20} /></div><p className="muted">Download your journal and revision history before a large import or deletion. Keep a dated copy somewhere private. Provider credentials are excluded.</p>{demo ? <button className="quiet-button" disabled><Download size={15} />Export available after sign-in</button> : <a className="quiet-button" href="/api/export" download><Download size={15} />Download journal JSON</a>}<p className="muted" style={{ fontSize: 12, marginTop: 15 }}>Free Supabase does not include automatic database backups. Journal exports are separate from full database backups and original source files.</p></section>
    <section className="card" style={{ marginTop: 22 }}><div className="section-heading"><h2>Delete your journal</h2><Trash2 size={19} /></div><p className="muted">Permanently remove your Remy entries, revision history, stored imports and saved provider connections. Source accounts and your Supabase sign-in account remain.</p><button className="quiet-button" disabled={demo || busy} onClick={() => { setConfirmation(''); setError(''); setDeleteOpen(true); }}>Delete all journal data</button></section>
    <AlertDialog open={deleteOpen} onOpenChange={open => { if (!busy) setDeleteOpen(open); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Permanently delete your journal?</AlertDialogTitle><AlertDialogDescription>This removes your nutrition and training history, revisions, stored imports and saved provider credentials from Remy. It cannot be undone. Download an export first if you want to keep your history.</AlertDialogDescription></AlertDialogHeader><Field label="Type DELETE MY JOURNAL to confirm"><Input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></Field>{error && <p className="error" role="alert">{error}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>Keep my journal</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy || confirmation !== 'DELETE MY JOURNAL'} onClick={event => { event.preventDefault(); void deleteJournal(); }}>{busy ? 'Deleting…' : 'Delete permanently'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
