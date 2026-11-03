"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, LoaderCircle, Sparkles, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Entry, Meal, Workout } from '@/lib/domain';
import type { CoachMessage, CoachProposal } from '@/lib/coach-types';
import { Field, MealDialog, type SaveRecord } from './forms';
import { MealDraft, preparePhoto } from './coach';
import styles from './log-food.module.css';

type Photo = Awaited<ReturnType<typeof preparePhoto>>;
type Estimate = { message: Entry<CoachMessage>; proposals: Entry<CoachProposal>[] };
type RequestPayload = { id: string; date: string; message: string; style: 'short'; consent: true; image?: Photo };

export function LogFoodDialog({ date, zone, records, workouts, demo, authenticated, onSave, onChanged, onClose }: {
  date: string; zone: string; records: Entry[]; workouts: Entry<Workout>[]; demo: boolean; authenticated: boolean;
  onSave: (record: SaveRecord) => Promise<void>; onChanged: () => Promise<void>; onClose: () => void;
}) {
  const [manual, setManual] = useState(demo);
  const [mealDate, setMealDate] = useState(date);
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [keepPhoto, setKeepPhoto] = useState(true);
  const [consent, setConsent] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const mounted = useRef(true), lock = useRef(false), version = useRef(0);
  const pending = useRef<RequestPayload | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const controllers = useRef(new Set<AbortController>());
  useEffect(() => {
    mounted.current = true;
    const requests = controllers.current;
    return () => { mounted.current = false; version.current++; pending.current = null; for (const controller of requests) controller.abort(); requests.clear(); };
  }, []);
  useEffect(() => {
    if (demo || !authenticated) return;
    const controller = new AbortController();
    fetch('/api/coach', { cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); const result = await response.json(); if (!controller.signal.aborted) setAvailable(result.available === true); })
      .catch(() => { if (!controller.signal.aborted) setAvailable(false); });
    return () => controller.abort();
  }, [demo, authenticated]);
  function clearPhoto() { version.current++; setPhoto(null); setPhotoBusy(false); pending.current = null; if (input.current) input.current.value = ''; }
  async function choosePhoto(file?: File) {
    if (!file) return;
    const current = ++version.current;
    setPhoto(null); setPhotoBusy(true); setError(''); pending.current = null;
    try { const image = await preparePhoto(file); if (mounted.current && current === version.current) setPhoto(image); }
    catch (error) { if (mounted.current && current === version.current) setError(error instanceof Error ? error.message : 'Could not prepare this photo.'); }
    finally { if (mounted.current && current === version.current) setPhotoBusy(false); }
  }
  async function request(path: string, payload: unknown) {
    const controller = new AbortController(); controllers.current.add(controller);
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not complete this request.'); return result;
    } finally { controllers.current.delete(controller); }
  }
  async function generate(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !available || !consent || photoBusy || (!photo && !notes.trim())) return;
    lock.current = true; setBusy(true); setError('');
    const message = notes.trim() || 'Estimate the food I ate in this photo as a meal draft. Ask if the portion is unclear.';
    if (!pending.current || pending.current.date !== mealDate || pending.current.message !== message || pending.current.image?.base64 !== photo?.base64)
      pending.current = { id: crypto.randomUUID(), date: mealDate, message, style: 'short', consent: true, ...(photo ? { image: photo } : {}) };
    try {
      const result: Estimate = await request('/api/coach', pending.current);
      if (!mounted.current) return;
      setEstimate(result); pending.current = null;
      await onChanged();
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Could not estimate this meal.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function decide(proposal: Entry<CoachProposal>, decision: 'save' | 'dismiss', reviewedDate?: string, meal?: Meal) {
    if (lock.current) throw new Error('Wait for the current request to finish.');
    lock.current = true; setBusy(true);
    try {
      const result = await request('/api/coach/proposals', {
        id: proposal.id, revision: proposal.revision, decision,
        ...(decision === 'save' ? { date: reviewedDate, meal, ...(photo && keepPhoto ? { image: photo } : {}) } : {}),
      });
      if (!mounted.current) return;
      setEstimate(current => current ? { ...current, proposals: current.proposals.map(entry => entry.id === proposal.id ? result.proposal : entry) } : current);
      await onChanged();
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  if (manual) return <MealDialog entry={null} date={mealDate} zone={zone} workouts={workouts} onSave={onSave} onClose={onClose} />;
  const disabled = !authenticated || demo || available !== true;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className={`form-dialog ${styles.dialog}`}>
      <DialogHeader><DialogTitle>Log food</DialogTitle><DialogDescription>Describe your food or add a photo. Review the estimate before saving it to your journal.</DialogDescription></DialogHeader>
      {!estimate && <>
        <button type="button" className={`text-button ${styles.manual}`} disabled={busy || photoBusy} onClick={() => { clearPhoto(); setManual(true); }}>Enter nutrition numbers yourself</button>
        {disabled && <p className="muted" role="status">{!authenticated ? 'Sign in to use photo estimates.' : available === null ? 'Checking photo estimates…' : 'AI estimates are unavailable. You can still enter a meal yourself.'}</p>}
        <form onSubmit={generate} className={styles.form}>
          <fieldset disabled={disabled || busy || photoBusy}>
            <Field label="Date eaten"><Input type="date" required value={mealDate} onChange={event => { setMealDate(event.target.value); pending.current = null; }} /></Field>
            <Field label="Food and portions (optional with a photo)"><Textarea rows={3} maxLength={6000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="For example: I ate this whole bowl, with 1 cup of rice and 200 g of tofu. Dressing was on the side." /></Field>
            <button type="button" className={`quiet-button ${styles.choose}`} onClick={() => input.current?.click()}><Camera size={20} /> {photo ? 'Change photo' : 'Add a food photo'}</button>
            <input ref={input} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose a food photo" onChange={event => void choosePhoto(event.target.files?.[0])} />
          </fieldset>
          {photoBusy && <p className="muted" role="status">Preparing your photo…</p>}
          {photo && <div className={styles.preview}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:${photo.mimeType};base64,${photo.base64}`} alt="Selected food photo" />
            <button type="button" className="quiet-button" disabled={busy} onClick={clearPhoto} aria-label="Remove food photo"><X size={16} /></button>
          </div>}
          <label className="check-row"><input type="checkbox" checked={consent} disabled={disabled || busy} onChange={event => setConsent(event.target.checked)} /><span>Share this food description, photo and relevant journal context with OpenAI for an estimate. <a href="/privacy" target="_blank" rel="noreferrer">Privacy</a></span></label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary-button" disabled={disabled || busy || photoBusy || !consent || (!photo && !notes.trim())}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />} {busy ? 'Estimating…' : 'Estimate meal'}</button>
        </form>
      </>}
      {estimate && <div className={styles.review}>
        <p className={styles.reply}>{estimate.message.data.text}</p>
        {photo && <div className={styles.retention}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:${photo.mimeType};base64,${photo.base64}`} alt="Photo used for this meal estimate" />
          <label className="check-row"><input type="checkbox" checked={keepPhoto} disabled={busy} onChange={event => setKeepPhoto(event.target.checked)} /><span>Keep this photo privately with each meal I save. Unsaved photo bytes are discarded when this window closes.</span></label>
        </div>}
        {estimate.proposals.map(proposal => <MealDraft key={proposal.id} entry={proposal} original={records.find(entry => entry.id === proposal.data.targetId) as Entry<Meal> | undefined} timezone={zone} disabled={busy} onDecision={decide} />)}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions"><button className="quiet-button" disabled={busy} onClick={() => { if (estimate.proposals.length && estimate.proposals.every(proposal => proposal.data.status !== 'pending')) { clearPhoto(); setNotes(''); } setEstimate(null); setError(''); }}>{estimate.proposals.length && estimate.proposals.every(proposal => proposal.data.status !== 'pending') ? 'Log another meal' : 'Edit description'}</button><button className="primary-button" disabled={busy} onClick={onClose}>Done</button></div>
      </div>}
    </DialogContent>
  </Dialog>;
}
