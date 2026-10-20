"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Camera,
  Check,
  ChevronDown,
  Footprints,
  Leaf,
  LoaderCircle,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { summarize, ofKind, round, type Entry, type Meal, type Nutrients } from "@/lib/domain";
import { coachContextFingerprint, coachProgress } from "@/lib/coach-context";
import type { CoachMessage, CoachProposal } from "@/lib/coach-types";
import { formInstant, localClock } from "@/lib/form-time";
import { etlFields, Field } from "./forms";

type Style = "short" | "medium" | "extended";
type Photo = { mimeType: "image/jpeg"; base64: string };
type CoachRequest = {
  id: string;
  date: string;
  message: string;
  style: Style;
  consent: true;
  image?: Photo;
};
type ProposalDecision = "save" | "dismiss";
const nutrientFields = [
  ["calories", "Energy", "kcal"],
  ["protein", "Protein", "g"],
  ["carbs", "Carbs", "g"],
  ["fat", "Fat", "g"],
  ["fiber", "Fiber", "g"],
] as const;
const amount = (value: number | null | undefined, unit = "") =>
  value == null ? "—" : `${round(value).toLocaleString()}${unit ? ` ${unit}` : ""}`;
const numeric = (value: string) => value === "" ? null : Number(value);

/** Canvas creates a new, bounded image; original metadata and bytes are not sent. */
async function preparePhoto(file: File): Promise<Photo> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP photo.");
  }
  if (file.size > 20_000_000) {
    throw new Error("Choose a photo smaller than 20 MB.");
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not prepare this photo.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.84, 0.72, 0.6, 0.48]) {
      const encoded = canvas.toDataURL("image/jpeg", quality);
      const base64 = encoded.slice(encoded.indexOf(",") + 1);
      if (base64.length * 0.75 <= 900_000) return { mimeType: "image/jpeg", base64 };
    }
    throw new Error("This photo is still too large. Choose a smaller crop.");
  } finally {
    bitmap.close();
  }
}

function MealDraft({
  entry,
  original,
  timezone,
  disabled,
  onDecision,
}: {
  entry: Entry<CoachProposal>;
  original?: Entry<Meal>;
  timezone: string;
  disabled: boolean;
  onDecision: (
    entry: Entry<CoachProposal>,
    decision: ProposalDecision,
    date?: string,
    meal?: Meal,
  ) => Promise<void>;
}) {
  const proposal = entry.data;
  const [meal, setMeal] = useState<Meal>(() => ({
    ...proposal.meal,
    etl: { ...proposal.meal.etl },
  }));
  const [date, setDate] = useState(proposal.date);
  const [time, setTime] = useState(() => localClock(proposal.meal.mealTime, timezone));
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState<ProposalDecision | null>(null);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const finished = proposal.status !== "pending";
  async function decide(decision: ProposalDecision, event?: FormEvent) {
    event?.preventDefault();
    if (lock.current || disabled || finished || (decision === "save" && !reviewed)) return;
    lock.current = true;
    setBusy(decision);
    setError("");
    try {
      await onDecision(entry, decision, date, decision === "save" ? {
        ...meal,
        mealTime: formInstant(date, time, timezone, proposal.date, proposal.meal.mealTime),
      } : undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save this decision.");
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }
  return (
    <article className={`coach-draft ${finished ? "coach-draft-finished" : ""}`}>
      <div className="coach-draft-heading">
        <div>
          <span className="eyebrow">
            {proposal.action === "update" ? "Correction draft" : "Meal draft"}
          </span>
          <h3>{proposal.meal.title}</h3>
        </div>
        <span className="pill">
          {proposal.status === "saved" ? <><Check size={13} /> Saved</>
            : proposal.status === "dismissed" ? "Dismissed" : "Review to save"}
        </span>
      </div>
      {finished ? (
        <p className="microcopy">
          {proposal.status === "saved"
            ? `${proposal.action === "update" ? "Corrected" : "Added"} in your journal for ${proposal.date}.`
            : "This draft was not added to your food totals."}
        </p>
      ) : (
        <form onSubmit={(event) => void decide("save", event)}>
          <p className="muted coach-draft-intro">
            {proposal.action === "update"
              ? "Saving replaces the original meal, so the correction is counted once."
              : "This estimate is separate from your saved totals until you review and save it."}
          </p>
          {proposal.action === "update" && (
            <div className="coach-original">
              <strong>Original meal</strong>
              {original ? (
                <>
                  <p>{original.localDate}{original.data.mealTime ? ` ${localClock(original.data.mealTime, timezone)}` : ""} · {original.data.mealType} · {original.data.title}</p>
                  <p>{nutrientFields.map(([key, label, unit]) =>
                    `${label}: ${amount(original.data[key], unit)}`).join(" · ")}</p>
                  <details>
                    <summary>Original food groups and notes</summary>
                    <p>{etlFields.map(([key, label, unit]) =>
                      `${label}: ${amount(original.data.etl?.[key], unit)}`).join(" · ")}</p>
                    {original.data.notes && <p>{original.data.notes}</p>}
                  </details>
                  {original.revision !== proposal.targetRevision && (
                    <p className="warning">
                      This meal changed after the draft was created. Ask Remy for a new correction.
                    </p>
                  )}
                </>
              ) : (
                <p>The original meal is not in this view. Remy will check its saved revision before updating it.</p>
              )}
            </div>
          )}
          {proposal.assumptions.length > 0 && (
            <details className="coach-assumptions" open>
              <summary>Portions and assumptions</summary>
              <ul>{proposal.assumptions.map((text, index) => <li key={index}>{text}</li>)}</ul>
            </details>
          )}
          <fieldset disabled={!!busy || disabled} className="coach-draft-fields">
            <div className="form-grid">
              <Field label="Date">
                <Input type="date" required value={date}
                  onChange={(event) => { setDate(event.target.value); setReviewed(false); }} />
              </Field>
              <Field label="Meal">
                <select className="coach-select" required value={meal.mealType}
                  onChange={(event) => { setMeal({ ...meal, mealType: event.target.value }); setReviewed(false); }}>
                  {["Breakfast", "Lunch", "Dinner", "Snack", "Run fuel"].map((choice) =>
                    <option key={choice} value={choice}>{choice}</option>)}
                </select>
              </Field>
              <Field label="Time eaten (optional)" hint={timezone}>
                <Input type="time" value={time}
                  onChange={(event) => { setTime(event.target.value); setReviewed(false); }} />
              </Field>
              <Field label="Nutrition source">
                <select className="coach-select" value={meal.confidence}
                  onChange={(event) => { setMeal({ ...meal, confidence: event.target.value as Meal["confidence"] }); setReviewed(false); }}>
                  {["estimate", "label", "recipe", "unknown"].map((choice) =>
                    <option key={choice} value={choice}>{choice}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Food and portions">
              <Input required maxLength={300} value={meal.title}
                onChange={(event) => { setMeal({ ...meal, title: event.target.value }); setReviewed(false); }} />
            </Field>
            <div className="form-grid nutrients">
              {nutrientFields.map(([key, label, unit]) => (
                <Field key={key} label={`${label} (${unit})`}>
                  <Input type="number" min="0" step="any" value={meal[key] ?? ""}
                    placeholder="Unknown"
                    onChange={(event) => {
                      setMeal({ ...meal, [key]: numeric(event.target.value) });
                      setReviewed(false);
                    }} />
                </Field>
              ))}
            </div>
            {original && nutrientFields.some(([key]) => original.data[key] !== meal[key]) && (
              <p className="microcopy coach-edits">
                Changes: {nutrientFields.filter(([key]) => original.data[key] !== meal[key])
                  .map(([key, label, unit]) => `${label} ${amount(original.data[key])} → ${amount(meal[key], unit)}`)
                  .join(" · ")}
              </p>
            )}
            <details className="form-details">
              <summary>Eat to Live, flexible foods and run fuel</summary>
              <p className="muted">
                Blank means unknown; enter 0 only when none was eaten. Flex and run fuel are
                parts of the energy above. Flax is included in nuts and seeds.
              </p>
              <div className="form-grid">
                {etlFields.map(([key, label, unit]) => (
                  <Field key={key} label={`${label} (${unit})`}>
                    <Input type="number" min="0" step="any" value={meal.etl?.[key] ?? ""}
                      placeholder="Unknown"
                      onChange={(event) => {
                        setMeal({ ...meal, etl: { ...meal.etl, [key]: numeric(event.target.value) } });
                        setReviewed(false);
                      }} />
                  </Field>
                ))}
              </div>
            </details>
            <Field label="Notes">
              <Textarea maxLength={2000} value={meal.notes}
                onChange={(event) => { setMeal({ ...meal, notes: event.target.value }); setReviewed(false); }} />
            </Field>
            <label className="check-row coach-review-check">
              <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
              <span>I reviewed the portions, estimates and meal date.</span>
            </label>
          </fieldset>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="form-actions">
            <button type="button" className="quiet-button" disabled={!!busy || disabled}
              onClick={() => void decide("dismiss")}>
              {busy === "dismiss" && <LoaderCircle size={15} className="animate-spin" />} Dismiss
            </button>
            <button type="submit" className="primary-button"
              disabled={!!busy || disabled || !reviewed || (!!original && original.revision !== proposal.targetRevision)}>
              {busy === "save" ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}
              {proposal.action === "update" ? "Save correction" : "Save meal"}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

function SavedProgress({ records, date }: { records: Entry[]; date: string }) {
  const progress = useMemo(() => coachProgress(records, date), [records, date]);
  const summary = useMemo(() => summarize(records, date), [records, date]);
  const historical = summary.nutritionSource === "historical-summary";
  const totals = historical ? summary.totals : progress.totals;
  const flexCalories = historical ? summary.etl.flexCalories.value : progress.flex.value;
  const runFuelCalories = historical ? summary.etl.runFuelCalories.value : progress.runFuelCalories;
  const latestRecovery = [...summary.recovery]
    .filter((entry) => entry.data.recovery != null || entry.data.sleepHours != null)
    .sort((a, b) => b.data.start.localeCompare(a.data.start))[0]?.data;
  const knownDurations = summary.workouts.filter((entry) => entry.data.durationSec != null);
  const minutes = knownDurations.length
    ? knownDurations.reduce((sum, entry) => sum + entry.data.durationSec! / 60, 0)
    : null;
  return (
    <aside className="coach-context">
      <section className="card coach-totals">
        <div className="section-heading">
          <h2><Leaf size={17} /> {historical ? "Historical daily intake" : "Saved intake"}</h2>
          <span>{historical ? "Coverage unknown" : progress.foodComplete ? "Logging complete" : "Logging in progress"}</span>
        </div>
        <p className="microcopy">{historical
          ? `Source daily estimate for ${date}. Individual meals and food-log coverage are unknown. Adding meals switches the whole date to their saved totals.`
          : `Journal totals for ${date}. Unsaved drafts are excluded.`}</p>
        <dl className="coach-nutrients">
          {nutrientFields.map(([key, label, unit]) => {
            const coverage = progress.nutrientCoverage[key as keyof Nutrients];
            return (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{amount(totals[key], unit)}
                  {!historical && coverage.known > 0 && !coverage.complete && (
                    <small>{coverage.known}/{coverage.total} meals known</small>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
        <p className="coach-target">Protein priority: {progress.protein.range.join("–")} g/day.</p>
        <p className="microcopy">
          {summary.profile.confirmed
            ? `Profile energy reference: ${amount(summary.target, "kcal")}. Fueling recommendations also consider the session and recovery context.`
            : "Confirm your maintenance baseline and body weight in Your profile to personalize energy and carbohydrate guidance."}
        </p>
      </section>
      <section className="card coach-etl">
        <details open>
          <summary>Eat to Live priorities <ChevronDown size={16} /></summary>
          <p className="microcopy">Your usual ranges guide choices. Running, digestion and adequate fueling come first. A dash means unknown; bars show known logged amounts.</p>
          {historical && <p className="microcopy">Food-group amounts below are historical daily estimates with unknown coverage.</p>}
          <div className="coach-etl-rows">
            {progress.etl.map((field) => {
              const fieldValue = historical ? summary.etl[field.key].value : field.value;
              return (
              <div key={field.key}>
                <div><span>{field.label}</span><strong>{amount(fieldValue, field.unit)}</strong></div>
                <div className="coach-meter" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, ((fieldValue ?? 0) / field.range[0]) * 100)}%` }} />
                </div>
                <small>
                  Usual {field.range.join("–")} {field.unit}
                  {!historical && field.known > 0 && field.known < field.total ? ` · ${field.known}/${field.total} meals known` : ""}
                </small>
              </div>
            );})}
          </div>
        </details>
        <div className="coach-flex">
          <strong>{historical ? "Historical flex estimate" : "Flexible foods"}: {amount(flexCalories, "kcal")}</strong>
          <p>Usual guide: about {progress.flex.range.join("–")} kcal.</p>
          <p>
            {historical ? "The historical summary cannot establish a complete 90/10 balance."
              : progress.flex.loggedPercent == null
              ? "Log energy and flex estimates for every meal to see the logged flex share."
              : `${amount(progress.flex.loggedPercent, "%")} of ${progress.flex.ratioComplete ? "the completed food log" : "intake logged so far"} is classified as flexible food.`}
          </p>
          <p>Run fuel: {amount(runFuelCalories, "kcal")} · included in intake.</p>
        </div>
      </section>
      <section className="card coach-training">
        <h2><Footprints size={17} /> Running & recovery</h2>
        <p>{summary.workouts.length
          ? `${summary.workouts.length} completed ${summary.workouts.length === 1 ? "activity" : "activities"} · ${amount(minutes, "min")} recorded for this date.${knownDurations.length < summary.workouts.length ? " Some activity durations are unknown." : ""}`
          : "No completed activity recorded for this date."}</p>
        <p>{summary.plans[0]
          ? `Next: ${summary.plans[0].data.title} · ${summary.plans[0].localDate}.`
          : "No planned session in the next 48 hours."}</p>
        <p>{latestRecovery
          ? `WHOOP recovery: ${amount(latestRecovery.recovery, "%")} · sleep: ${amount(latestRecovery.sleepHours, "h")}.`
          : "No WHOOP recovery or sleep available for this date."}</p>
        <p className="microcopy">Uses synchronized records. WHOOP and workout energy estimates are not added together as a calorie allowance.</p>
      </section>
    </aside>
  );
}

export function CoachView({
  records,
  date,
  demo,
  authenticated,
  onChanged,
}: {
  records: Entry[];
  date: string;
  demo: boolean;
  authenticated: boolean;
  onChanged: () => Promise<void>;
}) {
  const [availability, setAvailability] = useState<"checking" | "ready" | "unavailable" | "error">("checking");
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const [text, setText] = useState("");
  const [style, setStyle] = useState<Style>("medium");
  const [consent, setConsent] = useState(false);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [returnedEntries, setReturnedEntries] = useState<Entry[]>([]);
  const mounted = useRef(true);
  const requestLock = useRef(false);
  const photoVersion = useRef(0);
  const pending = useRef<CoachRequest | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const textarea = useRef<HTMLTextAreaElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const summary = useMemo(() => summarize(records, date), [records, date]);
  const combinedEntries = useMemo(() => {
    const combined = new Map(records.map((entry) => [entry.id, entry]));
    for (const entry of returnedEntries) {
      if (!combined.has(entry.id) || combined.get(entry.id)!.revision < entry.revision) combined.set(entry.id, entry);
    }
    return [...combined.values()];
  }, [records, returnedEntries]);
  const contextFingerprint = useMemo(() => coachContextFingerprint(records, date), [records, date]);
  const messages = ofKind<CoachMessage>(combinedEntries, "message")
    .filter((entry) => entry.localDate === date && entry.data.mode === "ai-coach")
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const proposals = ofKind<CoachProposal>(combinedEntries, "proposal")
    .filter((entry) => entry.localDate === date && entry.data.mode === "ai-coach")
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const disabled = demo || !authenticated || availability !== "ready";
  useEffect(() => {
    mounted.current = true;
    const activeControllers = controllers.current;
    return () => {
      mounted.current = false;
      photoVersion.current++;
      pending.current = null;
      for (const controller of activeControllers) controller.abort();
      activeControllers.clear();
    };
  }, []);
  useEffect(() => {
    if (demo || !authenticated) return;
    const controller = new AbortController();
    setAvailability("checking");
    fetch("/api/coach", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not check coach availability.");
        const result = await response.json();
        if (!controller.signal.aborted) setAvailability(result.available ? "ready" : "unavailable");
      })
      .catch(() => { if (!controller.signal.aborted) setAvailability("error"); });
    return () => controller.abort();
  }, [authenticated, demo, availabilityAttempt]);
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages.length, busy]);

  function clearPhoto() {
    photoVersion.current++;
    setPhoto(null);
    setPhotoBusy(false);
    pending.current = null;
    if (photoInput.current) photoInput.current.value = "";
  }
  async function choosePhoto(file?: File) {
    if (!file) return;
    const version = ++photoVersion.current;
    setPhoto(null);
    setPhotoBusy(true);
    setError("");
    pending.current = null;
    try {
      const prepared = await preparePhoto(file);
      if (mounted.current && version === photoVersion.current) setPhoto(prepared);
    } catch (error) {
      if (mounted.current && version === photoVersion.current) {
        setError(error instanceof Error ? error.message : "Could not read this photo. Try another file.");
      }
    } finally {
      if (mounted.current && version === photoVersion.current) setPhotoBusy(false);
    }
  }
  function retain(entries: Entry[]) {
    setReturnedEntries((current) => {
      const values = new Map(current.map((entry) => [entry.id, entry]));
      entries.forEach((entry) => values.set(entry.id, entry));
      return [...values.values()];
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (requestLock.current || disabled || !consent || photoBusy || (!text.trim() && !photo)) return;
    requestLock.current = true;
    setBusy(true);
    setError("");
    const request = pending.current;
    if (!request || request.message !== text.trim() || request.style !== style ||
        request.image?.base64 !== photo?.base64 || request.date !== date) {
      pending.current = {
        id: crypto.randomUUID(), date, message: text.trim(), style, consent: true,
        ...(photo ? { image: photo } : {}),
      };
    }
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending.current),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) await onChanged();
        throw new Error(result.error ?? "Remy could not answer. Try again.");
      }
      if (!mounted.current || controller.signal.aborted) return;
      retain([result.message, ...(result.proposals ?? [])]);
      pending.current = null;
      setText("");
      clearPhoto();
      await onChanged();
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) {
        setError(error instanceof Error ? error.message : "Could not reach Remy. Your message is ready to retry.");
      }
    } finally {
      controllers.current.delete(controller);
      requestLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function decide(entry: Entry<CoachProposal>, decision: ProposalDecision, editedDate?: string, meal?: Meal) {
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const response = await fetch("/api/coach/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: entry.id, revision: entry.revision, decision,
          ...(decision === "save" ? { date: editedDate, meal } : {}),
        }),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403 || response.status === 409) await onChanged();
        throw new Error(result.error ?? "Could not save your review. Try again.");
      }
      if (!mounted.current || controller.signal.aborted) return;
      retain([result.proposal]);
      await onChanged();
      if (mounted.current) toast(decision === "save" ? `Reviewed meal saved for ${result.proposal.data.date}.` : "Meal draft dismissed.");
    } finally {
      controllers.current.delete(controller);
    }
  }
  const status = demo ? "Sample mode"
    : !authenticated ? "Sign in to begin"
      : availability === "ready" ? "Configured"
        : availability === "checking" ? "Checking connection" : "Not connected";
  return (
    <div className="coach-layout">
      <section className="card chat-card coach-card">
        <div className="chat-mode">
          <Sparkles size={20} />
          <div><strong>Remy · Eat to Live sidekick</strong><p>Fuel your running. Recover well. Keep your food priorities.</p></div>
          <span className="pill">{status}</span>
        </div>
        {disabled && (
          <div className="coach-availability" role="status">
            {demo ? "Explore your sample totals here. Exit sample mode to use the AI coach with your journal."
              : !authenticated ? <><a href="/login">Sign in</a> to talk with your coach and review meal estimates.</>
                : availability === "checking" ? "Checking the coach connection…"
                  : availability === "unavailable" ? "The AI coach isn’t connected yet. Your saved journal and totals are available below."
                    : "Could not check the coach connection."}
            {authenticated && !demo && ["unavailable", "error"].includes(availability) && (
              <button className="text-button" onClick={() => setAvailabilityAttempt((attempt) => attempt + 1)}>Check again</button>
            )}
          </div>
        )}
        <div className="chat-messages coach-messages" aria-live="polite">
          {!messages.length && (
            <div className="chat-welcome">
              <span className="empty-icon"><Leaf /></span>
              <h2>Eat well for the miles ahead.</h2>
              <p>
                Describe a meal or add a photo, plan your next run’s fuel, or review the day.
                Remy connects your saved food, Strava runs and WHOOP recovery with your goal
                of maintaining weight and supporting muscle.
              </p>
              <p className="microcopy">Meal estimates become editable drafts. Your review puts them in the journal.</p>
            </div>
          )}
          {messages.map((entry) => (
            <article className={`chat-message ${entry.data.role}`} key={entry.id}>
              <span>{entry.data.role === "user" ? "You" : "Remy · AI coach"}</span>
              {entry.data.hasPhoto && <small className="coach-photo-sent"><Camera size={12} /> Photo used for this reply</small>}
              <p>{entry.data.text}</p>
              {entry.data.role === "assistant" && !!entry.data.references?.length && (
                <details className="coach-references">
                  <summary>Nutrition and recovery references</summary>
                  <ul>{entry.data.references.filter((reference) => reference.url.startsWith("https://"))
                    .map((reference) => (
                      <li key={reference.url}><a href={reference.url} target="_blank" rel="noreferrer">{reference.title}</a></li>
                    ))}</ul>
                </details>
              )}
              {entry.data.role === "assistant" &&
                ((entry.data.fingerprint !== undefined && entry.data.fingerprint !== summary.fingerprint) ||
                (entry.data.contextFingerprint !== undefined && entry.data.contextFingerprint !== contextFingerprint)) && (
                <small className="warning">Food, training or recovery records have changed since this reply. Ask again for updated guidance.</small>
              )}
            </article>
          ))}
          {busy && <p className="coach-thinking" role="status"><LoaderCircle size={16} className="animate-spin" /> Remy is reviewing your context…</p>}
          <div ref={messagesEnd} />
        </div>
        {proposals.length > 0 && (
          <div className="coach-proposals">
            <h2>Meal reviews</h2>
            {proposals.map((entry) => (
              <MealDraft key={`${entry.id}:${entry.revision}`} entry={entry}
                original={ofKind<Meal>(records, "meal").find((meal) => meal.id === entry.data.targetId)}
                timezone={summary.profile.timezone}
                disabled={demo || !authenticated || busy}
                onDecision={decide} />
            ))}
          </div>
        )}
        <div className="suggestions coach-prompts">
          {[
            ["Log a meal", "Help me log this meal: ", "medium"],
            ["Fuel my next run", "How should I fuel my next run while keeping Eat to Live priorities?", "medium"],
            ["Review today", "Review my logged day: fueling, recovery, Eat to Live wins and gaps, and my best next move.", "extended"],
          ].map(([label, prompt, responseStyle]) => (
            <button className="quiet-button" key={label} disabled={disabled || busy || photoBusy}
              onClick={() => { setText(prompt); setStyle(responseStyle as Style); pending.current = null; textarea.current?.focus(); }}>
              {label}
            </button>
          ))}
        </div>
        <form className="coach-composer" onSubmit={(event) => void submit(event)}>
          <fieldset disabled={disabled || busy || photoBusy}>
            <legend className="sr-only">Message Remy</legend>
            <div className="coach-composer-toolbar">
              <div className="coach-style" role="group" aria-label="Reply length">
                {(["short", "medium", "extended"] as const).map((choice) => (
                  <button type="button" key={choice} aria-pressed={choice === style}
                    onClick={() => { setStyle(choice); pending.current = null; }}>
                    {choice === "extended" ? "Extended" : choice === "medium" ? "Medium" : "Short"}
                  </button>
                ))}
              </div>
              <button type="button" className="text-button" onClick={() => photoInput.current?.click()}>
                <Camera size={16} /> Add photo
              </button>
              <input className="sr-only" ref={photoInput} type="file"
                accept="image/jpeg,image/png,image/webp" aria-label="Choose a meal photo"
                onChange={(event) => void choosePhoto(event.target.files?.[0])} />
            </div>
            <label className="sr-only" htmlFor="coach-message">Your meal or question</label>
            <Textarea ref={textarea} id="coach-message" rows={3} maxLength={6000} value={text}
              placeholder="What did you eat, or what are you training for?"
              onChange={(event) => { setText(event.target.value); pending.current = null; }} />
          </fieldset>
          {photoBusy && <p className="coach-thinking" role="status"><LoaderCircle size={15} className="animate-spin" /> Preparing your photo…</p>}
          {photo && (
            <div className="coach-photo-preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:${photo.mimeType};base64,${photo.base64}`} alt="Selected meal photo" />
              <div><strong>Meal photo ready</strong><p>The photo is used for this reply and isn’t saved in your journal.</p></div>
              <button type="button" className="quiet-button" disabled={busy} onClick={clearPhoto} aria-label="Remove meal photo"><X size={16} /></button>
            </div>
          )}
          <label className="check-row coach-consent">
            <input type="checkbox" checked={consent} disabled={disabled || busy}
              onChange={(event) => setConsent(event.target.checked)} />
            <span>Share the journal, running and recovery context needed for this reply, plus any attached photo, with OpenAI. <a href="/privacy" target="_blank" rel="noreferrer">Privacy</a></span>
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="coach-send-row">
            <span>Estimates are editable. Saved meals determine your totals.</span>
            <button className="primary-button" type="submit"
              disabled={disabled || busy || photoBusy || !consent || (!text.trim() && !photo)}>
              {busy ? <LoaderCircle size={17} className="animate-spin" /> : <Send size={17} />}
              {busy ? "Thinking…" : error && pending.current ? "Retry" : "Ask Remy"}
            </button>
          </div>
        </form>
      </section>
      <SavedProgress records={records} date={date} />
    </div>
  );
}
