"use client";

import { useEffect, useState } from 'react';
import styles from './log-food.module.css';

export function MealPhoto({ entryId, title }: { entryId: string; title: string }) {
  const [open, setOpen] = useState(false), [failed, setFailed] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const url = `/api/meal-photo?id=${encodeURIComponent(entryId)}`;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); let objectUrl: string | undefined;
    setFailed(false); setPhotoUrl(null);
    fetch(url, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok || !/^image\/(jpeg|png|webp)(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error();
      const image = await response.blob(); if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(image); setPhotoUrl(objectUrl);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [open, url]);
  return <div className={styles.savedPhoto}>
    <button type="button" className="text-button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide photo' : 'View meal photo'}</button>
    {open && (failed ? <p className="microcopy">This photo is unavailable. Refresh the journal or sign in again.</p>
      : !photoUrl ? <p className="microcopy" role="status">Loading photo…</p> : <a href={photoUrl} target="_blank" rel="noreferrer" aria-label={`Open photo of ${title}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl} alt={`Meal photo: ${title}`} onError={() => setFailed(true)} />
      </a>)}
  </div>;
}
