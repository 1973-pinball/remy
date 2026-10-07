import { authorize, body, json, failure } from '@/lib/http';
import { getEntry, listEntries, saveEntry, undo, deleteJournal, operationGuard, type OperationGuard } from '@/lib/store';
import { dateSchema, mealSchema, profileSchema, daySchema, planSchema, workoutSchema } from '@/lib/validation';
import { summarize, localDate, profileOf, type Kind } from '@/lib/domain';
import { assertJournalDate } from '@/lib/journal-date';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const user = await authorize(request);
    const entries = await listEntries(user.userId);
    const date = dateSchema.parse(new URL(request.url).searchParams.get('date') ?? localDate(new Date(), profileOf(entries).timezone));
    return json({ entries, summary: summarize(entries, date), user: { id: user.userId, name: user.fullName ?? '', email: user.email }, chatAvailable: false });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const user = await authorize(request, true);
    // Capture before reading a potentially slow request body. Deletion can
    // finish while validation runs; the original generation must still apply.
    let guard: OperationGuard | undefined;
    let guardError: unknown;
    try { guard = await operationGuard(user.userId); }
    catch (error) { guardError = error; }
    const b = await body(request);
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('Send a journal record.');
    if (b.action === 'deleteAll') {
      if (b.confirmation !== 'DELETE MY JOURNAL') throw new Error('Type DELETE MY JOURNAL to confirm.');
      // A failed deletion can be retried while the journal is marked deleting.
      return json(await deleteJournal(user.userId));
    }
    if (!guard) throw guardError ?? Object.assign(new Error('The journal could not be prepared for this change. Please retry.'), { status: 503 });
    if (b.action === 'undo') return json(await undo(user.userId, String(b.id), Number(b.revision), guard));

    const kind = b.kind as Kind;
    const schemas = { meal: mealSchema, savedMeal: mealSchema, profile: profileSchema, day: daySchema, plan: planSchema, workout: workoutSchema };
    if (!Object.hasOwn(schemas, kind)) throw new Error('Unsupported record type.');
    if (b.revision != null && (!Number.isSafeInteger(b.revision) || b.revision < 1)) throw new Error('A valid revision is required.');
    const schema = schemas[kind as keyof typeof schemas];
    let data = schema.parse(b.data);
    const date = kind === 'profile' || kind === 'savedMeal' ? null : dateSchema.parse(b.localDate);
    const id = kind === 'profile' ? 'profile' : kind === 'day' ? `day:${date}` : b.id;
    if (id != null && (typeof id !== 'string' || !/^[A-Za-z0-9:_-]{1,180}$/.test(id))) throw new Error('Invalid record identity.');
    const old = id ? await getEntry(user.userId, id) : null;
    if (old && old.kind !== kind) throw new Error('Record type cannot change.');

    if (kind === 'meal' || kind === 'workout' || kind === 'plan') {
      const savedProfile = await getEntry(user.userId, 'profile');
      const timezone = profileOf(savedProfile ? [savedProfile] : []).timezone;
      assertJournalDate(kind, date, data as Record<string, unknown>, timezone, old);
    }

    if (old) {
      if (b.revision == null) {
        const oldValidated = schema.parse(old.data);
        if (JSON.stringify(oldValidated) === JSON.stringify(data) && old.localDate === date && old.deleted === !!b.deleted) return json({ entry: old, duplicate: true });
        throw new Error('A revision is required to edit a record.');
      }
      if (old.source === 'runna' && kind === 'plan') {
        const original = planSchema.parse(old.data), incoming = data as typeof original;
        const allowed = { ...original, completedWorkoutId: incoming.completedWorkoutId };
        if (date !== old.localDate || JSON.stringify(allowed) !== JSON.stringify(incoming)) throw new Error('Imported Runna sessions keep their prescription. Move or edit in Runna and sync; only completion links can be changed here.');
      }
      data = { ...old.data, ...data } as typeof data;
    }

    if (kind === 'meal' && (data as { workoutId?: string }).workoutId) {
      const run = await getEntry(user.userId, (data as { workoutId: string }).workoutId);
      if (run?.kind !== 'workout' || run.deleted) throw new Error('Choose an existing run.');
    }
    if (kind === 'plan' && (data as { completedWorkoutId?: string }).completedWorkoutId) {
      const run = await getEntry(user.userId, (data as { completedWorkoutId: string }).completedWorkoutId);
      if (run?.kind !== 'workout' || run.deleted) throw new Error('Choose an existing completed run.');
    }
    // A profile timezone edit updates this record only. Previously assigned
    // journal dates remain stable; new date/time assignments use the new zone.
    return json(await saveEntry(user.userId, { id, kind, localDate: date, data, expectedRevision: b.revision, deleted: !!b.deleted, guard }));
  } catch (error) { return failure(error); }
}
