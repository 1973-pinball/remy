import 'server-only';
import { createAdminClient } from './supabase/admin';
import type { SaveInput } from './store';

/** All plugin writes use one transaction and the same owner lock as app writes. */
export async function saveMcpEntries(owner: string, inputs: SaveInput[], foodSnapshot?: Record<string, number>) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner))
    throw new Error('Invalid journal owner.');
  if (!inputs.length || inputs.length > 20 || inputs.some(input => !input.id))
    throw new Error('Invalid food draft batch.');
  const { error } = await createAdminClient().rpc('remy_mcp_save_entries', {
    p_owner: owner, p_entries: inputs, p_food_snapshot: foodSnapshot ?? null,
  });
  if (!error) return;
  const message = error.message ?? '';
  if (message.includes('REMY_FOOD_SNAPSHOT_CONFLICT'))
    throw Object.assign(new Error('Food was changed in another session. Read the latest food log and retry the same draft after checking duplicates.'), { status: 409 });
  if (message.includes('REMY_STALE_OPERATION') || message.includes('REMY_DELETING') || message.includes('REMY_MCP_DISABLED'))
    throw Object.assign(new Error('The journal or plugin connection changed. Reconnect or refresh before saving food.'), { status: 409, staleOperation: true });
  if (message.includes('REMY_CONFLICT'))
    throw Object.assign(new Error('This food record changed in another session. Prepare a fresh correction.'), { status: 409 });
  throw new Error('The food draft could not be saved. Verify the Remy plugin migration and retry.');
}
