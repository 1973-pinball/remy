import { authorizeMcp, mcpAuthFailure, MCP_AUTH_SCOPES, type McpIdentity } from '@/lib/mcp-auth';
import { callFoodTool, MCP_FOOD_TOOLS } from '@/lib/mcp-food';
import { saveMcpEntries } from '@/lib/mcp-food-store';
import { REMY_PLUGIN_INSTRUCTIONS } from '@/lib/mcp-instructions';
import { createRemyMcpTransport, type RemyToolDefinition } from '@/lib/mcp-transport';
import { appOrigin } from '@/lib/supabase/config';
import * as store from '@/lib/store';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const profileTool: RemyToolDefinition = {
  name: 'get_profile', title: 'Identify your connected Remy journal',
  description: 'Return the authenticated journal account identifier and display name. Use to confirm which private Remy account is connected. Does not return credentials or edit data.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};

export async function POST(request: Request) {
  const origin = appOrigin();
  const handle = createRemyMcpTransport({
    origin, scopes: MCP_AUTH_SCOPES, instructions: REMY_PLUGIN_INSTRUCTIONS,
    tools: [profileTool, ...MCP_FOOD_TOOLS] as readonly RemyToolDefinition[],
    authorize: authorizeMcp, authFailure: mcpAuthFailure,
    call: async (name, args, authenticated) => {
      const identity = authenticated as McpIdentity;
      const guard = identity.guard;
      if (guard.disabled) throw Object.assign(new Error('Reconnect the Remy plugin after resetting or disconnecting your journal.'), { status: 403 });
      if (name === 'get_profile') {
        if (Object.keys(args).length) throw Object.assign(new Error('This tool takes no arguments.'), { status: 400 });
        return { id: identity.userId, display_name: identity.fullName ? `${identity.fullName} · Remy Mux` : 'Your Remy Mux journal' };
      }
      const result = await callFoodTool(name, args, { owner: identity.userId, guard, store: { ...store, saveEntries: saveMcpEntries } });
      const date = 'date' in result && typeof result.date === 'string' ? result.date : undefined;
      return { ...result, journalUrl: `${origin}/?view=Today${date ? `&date=${encodeURIComponent(date)}` : ''}` };
    },
  });
  return handle(request);
}

export function GET() { return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } }); }
export const DELETE = GET;
