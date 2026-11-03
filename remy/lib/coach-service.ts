import { z } from 'zod';
import { ofKind, profileOf, summarize, type Entry, type Meal } from './domain';
import { dateSchema, mealSchema } from './validation';
import { assertJournalDate } from './journal-date';
import { buildCoachContext, coachRequestDigest, coachRequestSchema, validateCoachImage, type CoachRequest, type generateCoach } from './coach-model';
import { COACH_REFERENCES, coachContextFingerprint } from './coach-context';
import type { CoachImage, CoachMessage, CoachProposal } from './coach-types';
import type { OperationGuard, SaveInput } from './store';

export interface CoachStore {
  getEntry(owner: string, id: string): Promise<Entry | null>;
  listEntries(owner: string): Promise<Entry[]>;
  saveEntry(owner: string, input: SaveInput): Promise<{ entry: Entry; duplicate: boolean }>;
  saveEntries(owner: string, inputs: SaveInput[]): Promise<void>;
  acquireRefreshLock(owner: string, name: string): Promise<string | null>;
  releaseRefreshLock(owner: string, name: string, token: string): Promise<void>;
  saveMealPhoto?(owner: string, proposalId: string, image: CoachImage, guard: OperationGuard): Promise<string>;
  removeMealPhoto?(owner: string, path: string): Promise<void>;
}
type Generate = (input: CoachRequest, context: ReturnType<typeof buildCoachContext>) => ReturnType<typeof generateCoach>;
type StoredRequest = CoachMessage & { attemptedAt?: string[] };
const problem = (text: string, status = 409) => Object.assign(new Error(text), { status });
const LOCK = 'ai-coach';

async function locked<T>(store: CoachStore, owner: string, action: () => Promise<T>) {
  const token = await store.acquireRefreshLock(owner, LOCK);
  if (!token) throw problem('Another coach request is running. Wait a moment, then retry.', 429);
  try { return await action(); }
  finally {
    // A failed unlock must not turn a committed write into a failed response.
    // The database lease expires after 120 seconds.
    await store.releaseRefreshLock(owner, LOCK, token).catch(() => undefined);
  }
}
function requireCoachEntry(entry: Entry | null, kind: 'message' | 'proposal') {
  if (!entry || entry.deleted || entry.kind !== kind || entry.data.mode !== 'ai-coach')
    throw problem('This coach record is no longer available. Refresh the journal.');
  return entry;
}
async function savedReply(store: CoachStore, owner: string, entry: Entry) {
  const message = requireCoachEntry(entry, 'message') as unknown as Entry<CoachMessage>;
  const proposals = await Promise.all((message.data.proposalIds ?? []).map(id => store.getEntry(owner, id)));
  return {
    message,
    proposals: proposals.filter(e => e && !e.deleted && e.kind === 'proposal' && e.data.mode === 'ai-coach') as unknown as Entry<CoachProposal>[],
  };
}

/** No meal writes occur here. A request ID replays the same saved result. */
export async function sendCoach(
  owner: string, input: CoachRequest, guard: OperationGuard, store: CoachStore, generate: Generate,
  now = new Date().toISOString(),
) {
  const digest = coachRequestDigest(input);
  return locked(store, owner, async () => {
    const userId = `coach-user:${input.id}`, replyId = `coach-reply:${input.id}`;
    const prior = await store.getEntry(owner, userId);
    if (prior && (prior.deleted || prior.kind !== 'message' || prior.data.mode !== 'ai-coach' || prior.data.requestDigest !== digest))
      throw problem('This request ID belongs to a different message. Send a new message.');
    const reply = await store.getEntry(owner, replyId);
    if (reply) {
      if (!prior) throw problem('This coach request is inconsistent. Refresh the journal.');
      return savedReply(store, owner, reply);
    }
    const entries = await store.listEntries(owner);
    const nowMs = Date.parse(now);
    const attempts = ofKind<StoredRequest>(entries, 'message')
      .filter(e => e.data.mode === 'ai-coach' && e.data.role === 'user')
      .flatMap(e => e.data.attemptedAt ?? []).map(Date.parse);
    if (attempts.filter(t => t >= nowMs - 3_600_000).length >= 30 ||
        attempts.filter(t => t >= nowMs - 86_400_000).length >= 100)
      throw problem('The coach message allowance has been reached (30 per hour, 100 per day). Try again later.', 429);
    const previousAttempts = (prior?.data.attemptedAt as string[] | undefined) ?? [];
    const userMessage: StoredRequest = {
      role: 'user', text: input.message || 'Estimate this food photo.', mode: 'ai-coach',
      style: input.style, hasPhoto: !!input.image, requestDigest: digest,
      attemptedAt: [...previousAttempts.filter(t => Date.parse(t) >= nowMs - 86_400_000), now],
    };
    // Count failed attempts too, without storing image bytes. The generation
    // captured before the request body prevents resurrection after Delete all.
    await store.saveEntry(owner, {
      guard, id: userId, kind: 'message', localDate: input.date,
      data: userMessage, expectedRevision: prior?.revision,
    });
    const context = buildCoachContext(entries.filter(e => e.id !== userId), input.date, now);
    const { output, model } = await generate(input, context);
    const targetIds = new Set<string>();
    const proposals: SaveInput[] = output.drafts.map((draft, index) => {
      const target = draft.targetId ? entries.find(e => e.id === draft.targetId && e.kind === 'meal' && !e.deleted) : undefined;
      if (draft.action === 'add' && draft.targetId !== null ||
          draft.action === 'update' && (!target || !context.meals.some(e => e.id === target.id)))
        throw problem('The coach could not identify the original meal safely. Clarify which meal you mean.', 422);
      if (target && targetIds.has(target.id))
        throw problem('The coach proposed two corrections to the same meal. Ask for one combined correction.', 422);
      if (target) targetIds.add(target.id);
      const meal = mealSchema.parse({
        ...draft.meal, confidence: 'estimate',
        messageTime: target ? (target.data as unknown as Meal).messageTime : now,
        ...(target?.data.photoId ? { photoId: target.data.photoId } : {}),
      });
      assertJournalDate('meal', draft.date, meal as unknown as Record<string, unknown>, context.timezone, target);
      if (meal.workoutId && !context.running.recent.some(e => e.id === meal.workoutId))
        throw problem('The coach returned an unknown run link. Try again without linking a run.', 422);
      const data: CoachProposal = {
        mode: 'ai-coach', action: draft.action, date: draft.date, meal,
        targetId: target?.id ?? null, targetRevision: target?.revision ?? null,
        status: 'pending', requestId: input.id, assumptions: draft.assumptions,
        generation: guard.generation, model, createdAt: now,
        ...(input.image ? { photoDigest: validateCoachImage(input.image)! } : {}),
      };
      return { guard, id: `coach-proposal:${input.id}:${index}`, kind: 'proposal', localDate: input.date, data };
    });
    const data: CoachMessage = {
      role: 'assistant', text: output.text, mode: 'ai-coach', style: input.style, hasPhoto: false,
      fingerprint: summarize(entries, input.date, { now }).fingerprint,
      contextFingerprint: coachContextFingerprint(entries, input.date),
      generatedAt: now, proposalIds: proposals.map(p => p.id!), model, references: [...COACH_REFERENCES],
    };
    // At most seven writes: one database transaction, so a lost response can
    // replay the reply and all proposals without another paid generation.
    await store.saveEntries(owner, [...proposals, { guard, id: replyId, kind: 'message', localDate: input.date, data }]);
    const saved = await store.getEntry(owner, replyId);
    return savedReply(store, owner, requireCoachEntry(saved, 'message'));
  });
}

export const coachDecisionSchema = z.object({
  id: z.string().regex(/^coach-proposal:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-5]$/i),
  revision: z.number().int().positive(), decision: z.enum(['save', 'dismiss']),
  date: dateSchema.optional(), meal: mealSchema.optional(),
  image: coachRequestSchema.innerType().shape.image,
}).strict();
export type CoachDecision = z.infer<typeof coachDecisionSchema>;

/** Only this explicit user decision can add or correct a meal. */
export async function decideCoach(
  owner: string, input: CoachDecision, guard: OperationGuard, store: CoachStore,
) {
  return locked(store, owner, async () => {
    const proposal = requireCoachEntry(await store.getEntry(owner, input.id), 'proposal') as unknown as Entry<CoachProposal>;
    const data = proposal.data;
    if (data.generation !== guard.generation)
      throw problem('The journal was reset after this estimate. Ask the coach again.');
    if (data.status !== 'pending') {
      if (data.status !== (input.decision === 'save' ? 'saved' : 'dismissed'))
        throw problem('This estimate was already handled differently. Refresh the journal.');
      // A retried confirmation returns the current meal, preserving later edits
      // or deletions rather than re-applying the original estimate.
      const meal = data.savedMealId ? await store.getEntry(owner, data.savedMealId) : null;
      return { proposal, meal: meal?.deleted ? null : meal, summary: summarize(await store.listEntries(owner), data.date) };
    }
    if (proposal.revision !== input.revision)
      throw problem('This estimate changed in another session. Refresh before saving.');
    const writes: SaveInput[] = [];
    let mealId: string | undefined, date = data.date, updatedMeal: Meal | undefined;
    let uploadedPhoto: string | undefined;
    if (input.image && input.decision !== 'save') throw new Error('Photos are saved only with a confirmed meal.');
    if (input.decision === 'save') {
      date = input.date ?? data.date;
      updatedMeal = mealSchema.parse(input.meal ?? data.meal);
      const target = data.action === 'update' && data.targetId ? await store.getEntry(owner, data.targetId) : null;
      if (data.action === 'update' && (!target || target.deleted || target.kind !== 'meal' || target.revision !== data.targetRevision))
        throw problem('The original meal changed after this estimate. Ask for a fresh correction so newer edits are preserved.');
      mealId = target?.id ?? `coach-meal:${proposal.id.slice('coach-proposal:'.length)}`;
      if (!target && await store.getEntry(owner, mealId))
        throw problem('This meal identity already exists. Refresh the journal.');
      const entries = await store.listEntries(owner);
      // The draft editor cannot assign photo references or rewrite message time.
      // A retained photo is attached below only after its reviewed digest matches.
      updatedMeal = {
        ...updatedMeal, messageTime: data.meal.messageTime,
        photoId: data.meal.photoId,
      };
      assertJournalDate('meal', date, updatedMeal as unknown as Record<string, unknown>, profileOf(entries).timezone, target);
      if (updatedMeal.workoutId && !entries.some(e => e.id === updatedMeal!.workoutId && e.kind === 'workout' && !e.deleted))
        throw new Error('Choose an existing run.');
      if (input.image) {
        if (!data.photoDigest || validateCoachImage(input.image) !== data.photoDigest)
          throw problem('This photo differs from the reviewed estimate. Create a new estimate before saving it.', 422);
        if (!store.saveMealPhoto || !store.removeMealPhoto) throw new Error('Private meal photo storage is unavailable.');
        uploadedPhoto = await store.saveMealPhoto(owner, proposal.id, input.image, guard);
        updatedMeal.photoId = uploadedPhoto;
      }
      writes.push({ guard, id: mealId, kind: 'meal', localDate: date, data: updatedMeal, expectedRevision: target?.revision });
    }
    const next: CoachProposal = {
      ...data, status: input.decision === 'save' ? 'saved' : 'dismissed',
      ...(mealId ? { savedMealId: mealId, date, meal: updatedMeal! } : {}),
    };
    writes.push({ guard, id: proposal.id, kind: 'proposal', localDate: proposal.localDate, data: next, expectedRevision: proposal.revision });
    try { await store.saveEntries(owner, writes); }
    catch (error) {
      if (uploadedPhoto && mealId) {
        // A response can be lost after a successful commit. Remove an upload only
        // when a fresh read proves it was not attached; otherwise preserve it.
        try {
          const [committedMeal, committedProposal] = await Promise.all([
            store.getEntry(owner, mealId), store.getEntry(owner, proposal.id),
          ]);
          const wasCommitted = committedProposal?.data.status === 'saved' && committedProposal.data.savedMealId === mealId;
          // A later edit can replace the photo while its earlier revision still
          // needs this file for Undo. The saved proposal proves that commit.
          if (!wasCommitted && committedMeal?.data.photoId !== uploadedPhoto) await store.removeMealPhoto!(owner, uploadedPhoto);
        } catch { /* An uncertain commit must not lose its photo. Delete all also clears private files. */ }
      }
      throw error;
    }
    return {
      proposal: await store.getEntry(owner, proposal.id),
      ...(mealId ? { meal: await store.getEntry(owner, mealId) } : {}),
      summary: summarize(await store.listEntries(owner), date),
    };
  });
}
