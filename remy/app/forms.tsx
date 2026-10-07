"use client";
import { useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LoaderCircle, Upload } from "lucide-react";
import {
  zonedInstant,
  type Entry,
  type Meal,
  type Profile,
  type Day,
  type Workout,
  type Plan,
} from "@/lib/domain";
import { localClock, formInstant } from "@/lib/form-time";
import type { Candidate, ImportPreview } from "@/lib/imports";
export type SaveRecord = {
  id?: string;
  kind: string;
  localDate: string | null;
  revision?: number;
  data: unknown;
  deleted?: boolean;
};
export const etlFields = [
  ["rawVegetablesG", "Raw vegetables", "g"],
  ["cookedVegetablesG", "Cooked vegetables", "g"],
  ["beansG", "Beans", "g"],
  ["soyG", "Whole soy", "g"],
  ["fruitServings", "Fruit", "servings"],
  ["starchCups", "Starchy foods", "cups"],
  ["nutsSeedsG", "Nuts & seeds", "g"],
  ["flaxG", "Flax", "g"],
  ["avocadoG", "Avocado", "g"],
  ["driedFruitG", "Dried fruit", "g"],
  ["flexCalories", "Flex foods", "kcal"],
  ["runFuelCalories", "Run fuel", "kcal"],
] as const;
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Choice({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem value={o} key={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
const num = (s: FormDataEntryValue | null) =>
  s == null || s === "" ? null : Number(s);
type ImportOutcome = {
  added: number;
  updated: number;
  duplicates: number;
  matched: number;
  conflicts: {
    recordId: string;
    reason: string;
    incoming: { date: string; kind: string };
  }[];
};
export function ImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const [format, setFormat] = useState("REMY meals / transcript"),
    [text, setText] = useState(""),
    [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null),
    [selected, setSelected] = useState<Set<number>>(new Set()),
    [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const fit = format === "Original FIT / FIT.GZ";
  async function request(action: "preview" | "commit") {
    setBusy(true);
    setError("");
    try {
      const payload =
        action === "preview"
          ? {
              action,
              text,
              format: fit
                ? "fit"
                : format === "Runna calendar (.ics)"
                  ? "ics"
                  : format === "Strava activities.csv"
                    ? "strava"
                    : "meals",
            }
          : {
              action,
              source: preview!.source,
              original: text,
              candidates: preview!.candidates.filter((_, i) => selected.has(i)),
              reviewed,
            };
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (action === "preview") {
        setPreview(result);
        setSelected(new Set());
        setReviewed(false);
      } else {
        setOutcome(result);
        await onImported();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function update(i: number, key: string, value: unknown) {
    setPreview((p) =>
      p
        ? {
            ...p,
            candidates: p.candidates.map((c, j) =>
              j === i
                ? ({ ...c, data: { ...c.data, [key]: value } } as Candidate)
                : c,
            ),
          }
        : p,
    );
  }
  async function readFile(file?: File) {
    if (!file) return;
    setError("");
    setText("");
    setFileName("");
    if (file.size > (fit ? 1_000_000 : 1_500_000)) {
      setError(
        fit
          ? "Choose a FIT or compressed FIT.GZ file under 1 MB."
          : "Split this file into batches under 1.5 MB.",
      );
      return;
    }
    try {
      if (fit) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 32768)
          binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        setText(btoa(binary));
      } else setText(await file.text());
      setFileName(file.name);
    } catch {
      setError("Could not read this file. Choose it again.");
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="form-dialog import-dialog">
        <DialogHeader>
          <DialogTitle>Bring your history into Remy Mux</DialogTitle>
          <DialogDescription>
            Review extracted entries before saving. Existing source entries keep
            their corrections on reimport.
          </DialogDescription>
        </DialogHeader>
        {outcome ? (
          <div className="import-outcome">
            <h3>Import reviewed and saved</h3>
            <p>
              {outcome.added} added · {outcome.updated} updated ·{" "}
              {outcome.duplicates} already present · {outcome.matched} runs
              matched
            </p>
            {outcome.conflicts.length > 0 && (
              <>
                <p className="warning">
                  {outcome.conflicts.length} entries need attention. Your
                  existing records were preserved.
                </p>
                {outcome.conflicts.map((c) => (
                  <div className="import-row" key={c.recordId}>
                    <p>{c.reason}</p>
                    <a
                      className="text-button"
                      href={`/?view=${c.incoming.kind === "meal" ? "Food" : "Training"}&date=${c.incoming.date}#${c.recordId}`}
                    >
                      Review original record
                    </a>
                  </div>
                ))}
              </>
            )}
            <button className="primary-button" onClick={onClose}>
              Done
            </button>
          </div>
        ) : !preview ? (
          <>
            <Field label="Source">
              <Choice
                value={format}
                onChange={(v) => {
                  setFormat(v);
                  setText("");
                  setFileName("");
                  setError("");
                }}
                label="Import source"
                options={[
                  "REMY meals / transcript",
                  "Strava activities.csv",
                  "Runna calendar (.ics)",
                  "Original FIT / FIT.GZ",
                ]}
              />
            </Field>
            <label className="file-drop">
              <Upload size={22} />
              <span>
                {fileName || `Choose a file${fit ? "" : ", or paste below"}`}
              </span>
              <input
                type="file"
                accept={fit ? ".fit,.gz" : ".json,.txt,.csv,.ics"}
                onChange={(e) => void readFile(e.target.files?.[0])}
              />
            </label>
            {!fit && (
              <Textarea
                aria-label="Import text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                placeholder={
                  '[{"id":"meal-1","date":"2026-10-06","title":"Lunch","calories":650,"carbs":80}]'
                }
              />
            )}
            <p className="muted">
              {fit
                ? "Original FIT records supply the activity summary. Runs already present from another source are matched where the available timestamps and distances support it."
                : "ChatGPT history requires an explicit export or pasted transcript. Photos and ambiguous corrections need review. Daily totals are never imported as individual meals."}
            </p>
            <button
              disabled={!text || busy}
              className="primary-button"
              onClick={() => request("preview")}
            >
              {busy ? "Reading…" : "Preview import"}
            </button>
          </>
        ) : (
          <>
            <div className="review-count">
              <strong>{preview.candidates.length} candidates</strong>
              <span>{selected.size} selected</span>
              <button
                className="text-button"
                onClick={() =>
                  setSelected(
                    new Set(
                      selected.size === preview.candidates.length
                        ? []
                        : preview.candidates.map((_, i) => i),
                    ),
                  )
                }
              >
                {selected.size === preview.candidates.length
                  ? "Deselect all"
                  : "Select all"}
              </button>
            </div>
            {preview.warnings.map((w, i) => (
              <p className="warning" key={i}>
                {w}
              </p>
            ))}
            <div className="import-rows">
              {preview.candidates.map((c, i) => (
                <div className="import-row" key={i}>
                  <label className="check-row">
                    <Checkbox
                      checked={selected.has(i)}
                      onCheckedChange={(v) =>
                        setSelected((old) => {
                          const s = new Set(old);
                          v ? s.add(i) : s.delete(i);
                          return s;
                        })
                      }
                    />
                    <strong>
                      {c.date} · {c.kind}
                    </strong>
                  </label>
                  <Input
                    aria-label={`Entry ${i + 1} title`}
                    value={c.data.title}
                    onChange={(e) => update(i, "title", e.target.value)}
                  />
                  {c.kind === "meal" ? (
                    <>
                      <div className="form-grid nutrients">
                        {(
                          [
                            "calories",
                            "carbs",
                            "protein",
                            "fat",
                            "fiber",
                          ] as const
                        ).map((k) => (
                          <Field key={k} label={k}>
                            <Input
                              aria-label={`Entry ${i + 1} ${k}`}
                              type="number"
                              min="0"
                              step="0.1"
                              value={c.data[k] ?? ""}
                              onChange={(e) =>
                                update(
                                  i,
                                  k,
                                  e.target.value === ""
                                    ? null
                                    : Number(e.target.value),
                                )
                              }
                            />
                          </Field>
                        ))}
                      </div>
                      <details>
                        <summary>
                          Review Eat to Live contributions and notes
                        </summary>
                        <div className="form-grid">
                          {etlFields.map(([key, label, unit]) => (
                            <Field key={key} label={`${label} (${unit})`}>
                              <Input
                                type="number"
                                min="0"
                                step="0.1"
                                value={c.data.etl?.[key] ?? ""}
                                onChange={(e) =>
                                  update(i, "etl", {
                                    ...c.data.etl,
                                    [key]:
                                      e.target.value === ""
                                        ? null
                                        : Number(e.target.value),
                                  })
                                }
                                placeholder="Unknown"
                              />
                            </Field>
                          ))}
                        </div>
                        <p className="muted">
                          {c.data.notes || "No source notes supplied."}
                        </p>
                        <small>
                          Nutrition source: {c.data.confidence}. Time eaten:{" "}
                          {c.data.mealTime ?? "unknown"}.
                        </small>
                      </details>
                    </>
                  ) : (
                    <p className="muted">
                      {c.data.distanceMeters == null
                        ? "Distance unknown"
                        : `${(c.data.distanceMeters / 1000).toFixed(2)} km`}{" "}
                      ·{" "}
                      {c.data.durationSec == null
                        ? "Duration unknown"
                        : `${Math.round(c.data.durationSec / 60)} min`}
                    </p>
                  )}
                  {c.warning && <small className="warning">{c.warning}</small>}
                </div>
              ))}
            </div>
            <label className="check-row">
              <Checkbox
                checked={reviewed}
                onCheckedChange={(v) => setReviewed(v === true)}
              />
              <span>
                I reviewed the selected entries, including portions and
                corrections.
              </span>
            </label>
            <div className="form-actions">
              <button className="quiet-button" onClick={() => setPreview(null)}>
                Back
              </button>
              <button
                disabled={!selected.size || !reviewed || busy}
                className="primary-button"
                onClick={() => request("commit")}
              >
                {busy ? "Saving…" : `Import ${selected.size} entries`}
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
export function MealDialog({
  entry,
  date,
  zone,
  workouts,
  onSave,
  onClose,
}: {
  entry: Entry<Meal> | null;
  date: string;
  zone: string;
  workouts: Entry<Workout>[];
  onSave: (r: SaveRecord) => Promise<void>;
  onClose: () => void;
}) {
  const [type, setType] = useState(entry?.data.mealType ?? "Dinner"),
    [confidence, setConfidence] = useState(
      entry?.data.confidence ?? "estimate",
    ),
    [run, setRun] = useState(entry?.data.workoutId ?? "none"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const meal = entry?.data;
  const isCorrection = !!entry?.revision;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const f = new FormData(e.currentTarget),
        mealDate = String(f.get("date")),
        time = String(f.get("time") ?? ""),
        etl: Record<string, number | null> = {};
      etlFields.forEach(([key]) => (etl[key] = num(f.get(key))));
      await onSave({
        id: entry?.id,
        kind: "meal",
        localDate: mealDate,
        revision: entry?.revision || undefined,
        data: {
          title: String(f.get("title")),
          mealType: type,
          mealTime: formInstant(
            mealDate,
            time,
            zone,
            entry?.localDate,
            meal?.mealTime,
          ),
          messageTime: meal?.messageTime ?? new Date().toISOString(),
          notes: String(f.get("notes")),
          confidence,
          workoutId: run === "none" ? null : run,
          calories: num(f.get("calories")),
          carbs: num(f.get("carbs")),
          protein: num(f.get("protein")),
          fat: num(f.get("fat")),
          fiber: num(f.get("fiber")),
          etl,
        },
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="form-dialog">
        <DialogHeader>
          <DialogTitle>
            {isCorrection ? "Correct this meal" : "Add to your food journal"}
          </DialogTitle>
          <DialogDescription>
            {isCorrection
              ? "Update the original entry. Its revision history is preserved."
              : "Use a label, recipe, or reviewed estimate. Leave unknown quantities blank."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <Field label="What did you eat?">
            <Input
              name="title"
              required
              maxLength={300}
              defaultValue={meal?.title}
              placeholder="Chickpea bowl, cooked greens, and rice"
            />
          </Field>
          <div className="form-grid">
            <Field label="Meal">
              <Choice
                label="Meal"
                value={type}
                onChange={setType}
                options={["Breakfast", "Lunch", "Dinner", "Snack", "Run fuel"]}
              />
            </Field>
            <Field label="Food date">
              <Input
                name="date"
                type="date"
                required
                defaultValue={entry?.localDate ?? date}
              />
            </Field>
            <Field label="Time eaten (optional)">
              <Input
                name="time"
                type="time"
                defaultValue={localClock(meal?.mealTime, zone)}
              />
            </Field>
            <Field label="Nutrition source">
              <Choice
                label="Nutrition source"
                value={confidence}
                onChange={(v) => setConfidence(v as Meal["confidence"])}
                options={["label", "recipe", "estimate", "unknown"]}
              />
            </Field>
          </div>
          <div className="form-grid nutrients">
            {(["calories", "carbs", "protein", "fat", "fiber"] as const).map(
              (k) => (
                <Field
                  key={k}
                  label={
                    k === "calories"
                      ? "Calories (kcal)"
                      : `${k[0].toUpperCase() + k.slice(1)} (g)`
                  }
                >
                  <Input
                    name={k}
                    type="number"
                    min="0"
                    step="0.1"
                    defaultValue={meal?.[k] ?? ""}
                    placeholder="Unknown"
                  />
                </Field>
              ),
            )}
          </div>
          <details className="form-details">
            <summary>Eat to Live contributions</summary>
            <p className="muted">
              Amounts in this meal only. Flex and run fuel are parts of its
              calories, not additional calories.
            </p>
            <div className="form-grid">
              {etlFields.map(([key, label, unit]) => (
                <Field key={key} label={`${label} (${unit})`}>
                  <Input
                    name={key}
                    type="number"
                    min="0"
                    step="0.1"
                    defaultValue={(meal as any)?.etl?.[key] ?? ""}
                    placeholder="Unknown"
                  />
                </Field>
              ))}
            </div>
          </details>
          <Field label="Link to a completed run">
            <Select value={run} onValueChange={setRun}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No linked run</SelectItem>
                {workouts.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.localDate} · {w.data.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Portions, recipe, or correction notes">
            <Textarea
              name="notes"
              defaultValue={meal?.notes ?? ""}
              maxLength={2000}
              placeholder="Portion sizes and anything uncertain"
            />
          </Field>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="button" className="quiet-button" onClick={onClose}>
              Cancel
            </button>
            <button disabled={busy} className="primary-button">
              {busy && <LoaderCircle size={16} className="animate-spin" />}
              {isCorrection ? "Save correction" : "Save meal"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function ProfileForm({
  profile,
  onSave,
}: {
  profile: Profile;
  onSave: (p: Profile) => Promise<void>;
}) {
  const [confirmed, setConfirmed] = useState(profile.confirmed),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const f = new FormData(e.currentTarget);
      await onSave({
        ...profile,
        name: String(f.get("name")),
        timezone: String(f.get("timezone")),
        baseline: Number(f.get("baseline")),
        baselineIncludes: String(f.get("includes")),
        weightKg: num(f.get("weight")),
        raceDate: String(f.get("race")) || null,
        goalMinutes: num(f.get("goal")),
        diet: String(f.get("diet")),
        weightGoal: String(f.get("weightGoal")),
        gutTolerance: String(f.get("gut")),
        confirmed,
      });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card profile-form" onSubmit={submit}>
      <h2>Your context, in your words.</h2>
      <p className="muted">
        Review these before using personalized nutrition references. Unset goals
        stay unknown.
      </p>
      <div className="form-grid">
        <Field label="Name">
          <Input name="name" defaultValue={profile.name} />
        </Field>
        <Field label="Timezone">
          <Input name="timezone" required defaultValue={profile.timezone} />
        </Field>
        <Field label="Current weight (kg)">
          <Input
            name="weight"
            type="number"
            min="25"
            max="350"
            step="0.1"
            defaultValue={profile.weightKg ?? ""}
          />
        </Field>
        <Field label="Marathon date">
          <Input
            name="race"
            type="date"
            defaultValue={profile.raceDate ?? ""}
          />
        </Field>
        <Field label="Finish-time goal (minutes)">
          <Input
            name="goal"
            type="number"
            min="90"
            max="1000"
            defaultValue={profile.goalMinutes ?? ""}
            placeholder="240 = 4 hours"
          />
        </Field>
        <Field label="Chosen calorie baseline">
          <Input
            name="baseline"
            type="number"
            min="500"
            max="10000"
            required
            defaultValue={profile.baseline}
          />
        </Field>
      </div>
      <Field
        label="What does this baseline already include?"
        hint="Automatic exercise additions stay off. Daily adjustments are always explicit."
      >
        <Input name="includes" defaultValue={profile.baselineIncludes} />
      </Field>
      <Field label="Dietary preferences and Eat to Live priorities">
        <Textarea
          name="diet"
          defaultValue={profile.diet}
          placeholder="Foods you enjoy, allergies, and how you approach Eat to Live"
        />
      </Field>
      <Field label="Weight-management goals">
        <Input
          name="weightGoal"
          defaultValue={profile.weightGoal}
          placeholder="Optional; supporting training may be your only goal"
        />
      </Field>
      <Field label="Fueling practice and gut tolerance">
        <Textarea
          name="gut"
          defaultValue={profile.gutTolerance}
          placeholder="Gels, carbohydrate amounts, and fiber timing you tolerate"
        />
      </Field>
      <label className="check-row">
        <Checkbox
          checked={confirmed}
          onCheckedChange={(v) => setConfirmed(v === true)}
        />
        <span>
          I reviewed these details. Use confirmed values for personalized
          calculations.
        </span>
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="primary-button" disabled={busy}>
        {busy ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
export function DayDialog({
  day,
  onSave,
  onClose,
}: {
  day: Day;
  onSave: (d: Day) => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Today’s calorie adjustment</DialogTitle>
          <DialogDescription>
            Your baseline is a chosen starting point. Exercise is never added
            automatically.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await onSave({
                ...day,
                adjustment: Number(f.get("adjustment")),
                adjustmentReason: String(f.get("reason")),
                feedback: String(f.get("feedback")),
              });
              onClose();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <Field label="Adjustment (kcal)">
            <Input
              name="adjustment"
              type="number"
              min="-2000"
              max="10000"
              defaultValue={day.adjustment}
            />
          </Field>
          <Field label="Reason">
            <Input
              name="reason"
              defaultValue={day.adjustmentReason}
              placeholder="Long run tomorrow, appetite, or another reason"
            />
          </Field>
          <Field label="Hunger, energy, or performance notes">
            <Textarea name="feedback" defaultValue={day.feedback} />
          </Field>
          {error && <p className="error">{error}</p>}
          <button className="primary-button">Save adjustment</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function TrainingDialog({
  entry,
  planned,
  date,
  zone,
  onSave,
  onClose,
}: {
  entry?: Entry<Plan | Workout>;
  planned: boolean;
  date: string;
  zone: string;
  onSave: (r: SaveRecord) => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  const d = entry?.data;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="form-dialog">
        <DialogHeader>
          <DialogTitle>
            {entry ? "Edit" : "Add"}{" "}
            {planned ? "planned session" : "completed run"}
          </DialogTitle>
          <DialogDescription>
            {planned
              ? "A local plan entry. Changes do not alter your Runna program."
              : "Headline numbers only; keep detailed run analysis in your running app."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              const day = String(f.get("date")),
                time = String(f.get("time"));
              await onSave({
                id: entry?.id,
                kind: planned ? "plan" : "workout",
                localDate: day,
                revision: entry?.revision,
                data: {
                  title: String(f.get("title")),
                  start: formInstant(
                    day,
                    time,
                    zone,
                    entry?.localDate,
                    d?.start,
                  ),
                  durationSec:
                    num(f.get("duration")) == null
                      ? null
                      : Number(f.get("duration")) * 60,
                  distanceMeters:
                    num(f.get("distance")) == null
                      ? null
                      : Number(f.get("distance")) * 1000,
                  notes: String(f.get("notes")),
                  ...(planned
                    ? {
                        allDay: !time,
                        intensity: String(f.get("intensity")),
                        completedWorkoutId:
                          (d as Plan)?.completedWorkoutId ?? null,
                      }
                    : {
                        sport: "running",
                        avgHr: num(f.get("hr")),
                        calories: num(f.get("calories")),
                        elevationMeters:
                          (d as Workout)?.elevationMeters ?? null,
                      }),
                },
              });
              onClose();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <Field label="Session">
            <Input
              name="title"
              defaultValue={d?.title}
              required
              placeholder={planned ? "Long run" : "Easy run"}
            />
          </Field>
          <div className="form-grid">
            <Field label="Date">
              <Input
                name="date"
                type="date"
                defaultValue={entry?.localDate ?? date}
                required
              />
            </Field>
            <Field label={planned ? "Time (blank for all-day)" : "Start time"}>
              <Input
                name="time"
                type="time"
                defaultValue={localClock(d?.start, zone)}
                required={!planned}
              />
            </Field>
            <Field label="Duration (minutes)">
              <Input
                name="duration"
                type="number"
                min="0"
                step="0.1"
                defaultValue={d?.durationSec == null ? "" : d.durationSec / 60}
              />
            </Field>
            <Field label="Distance (km)">
              <Input
                name="distance"
                type="number"
                min="0"
                step="0.01"
                defaultValue={
                  d?.distanceMeters == null ? "" : d.distanceMeters / 1000
                }
              />
            </Field>
            {planned ? (
              <Field label="Intensity">
                <Input
                  name="intensity"
                  defaultValue={(d as Plan)?.intensity ?? "Easy"}
                />
              </Field>
            ) : (
              <>
                <Field label="Average heart rate">
                  <Input
                    name="hr"
                    type="number"
                    min="0"
                    max="250"
                    defaultValue={(d as Workout)?.avgHr ?? ""}
                  />
                </Field>
                <Field label="Workout energy estimate (kcal)">
                  <Input
                    name="calories"
                    type="number"
                    min="0"
                    defaultValue={(d as Workout)?.calories ?? ""}
                  />
                </Field>
              </>
            )}
          </div>
          <Field label="Notes">
            <Textarea name="notes" defaultValue={d?.notes ?? ""} />
          </Field>
          {error && <p className="error">{error}</p>}
          <button className="primary-button">Save session</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
