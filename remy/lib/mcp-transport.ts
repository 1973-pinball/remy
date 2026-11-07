import { createMcpHandler, Server } from '@modelcontextprotocol/server';

export interface RemyToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: { type: 'object'; [key: string]: unknown };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}

export interface RemyMcpTransportDependencies {
  tools: readonly RemyToolDefinition[];
  instructions: string;
  scopes: readonly string[];
  origin: string;
  authorize(request: Request): Promise<unknown>;
  authFailure(error: unknown): Response;
  call(name: string, args: Record<string, unknown>, identity: unknown): Promise<unknown>;
}

const PUBLIC_METHODS = new Set(['initialize', 'notifications/initialized', 'ping', 'tools/list', 'server/discover']);
const MAX_BYTES = 128_000;

async function readJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error('Send a JSON request.'), { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw Object.assign(new Error('Request too large.'), { status: 413 });
      }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Send valid JSON.'), { status: 400 }); }
}

function privateResponse(response: Response) {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

/** Stateless HTTP: discovery is public; every data tool requires OAuth. */
export function createRemyMcpTransport(deps: RemyMcpTransportDependencies) {
  return async function handle(request: Request): Promise<Response> {
    const origin = request.headers.get('origin');
    if (origin && origin !== deps.origin && origin !== 'https://chatgpt.com') {
      return privateResponse(Response.json({ error: 'Origin is not allowed.' }, { status: 403 }));
    }
    if (request.method !== 'POST') {
      return privateResponse(new Response(null, { status: 405, headers: { Allow: 'POST' } }));
    }
    if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      return privateResponse(Response.json({ error: 'Use application/json.' }, { status: 415 }));
    }
    let parsed: unknown;
    try { parsed = await readJson(request); }
    catch (error) {
      const status = (error as { status?: number }).status ?? 400;
      return privateResponse(Response.json({ error: status === 413 ? 'Request too large.' : 'Send valid JSON.' }, { status }));
    }
    const message = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    // Batch requests and unknown envelopes never bypass authorization.
    let identity: unknown;
    if (!message || !PUBLIC_METHODS.has(String(message.method))) {
      try { identity = await deps.authorize(request); }
      catch (error) { return privateResponse(deps.authFailure(error)); }
    }
    const handler = createMcpHandler(() => {
      // Low-level registration preserves shared, already-validated JSON schemas
      // without converting the application's Zod 3 model into a second model.
      const server = new Server({ name: 'remy-mux', title: 'Remy Mux', version: '1.0.0', websiteUrl: deps.origin }, {
        capabilities: { tools: {} }, instructions: deps.instructions,
      });
      const securitySchemes = [{ type: 'oauth2', scopes: [...deps.scopes] }];
      server.setRequestHandler('tools/list', async () => ({
        tools: deps.tools.map(tool => ({ ...tool, securitySchemes, _meta: { securitySchemes } })),
      }));
      server.setRequestHandler('tools/call', async ({ params }) => {
        if (!identity) throw new Error('An authenticated connection is required.');
        if (!deps.tools.some(tool => tool.name === params.name)) {
          return { isError: true, content: [{ type: 'text', text: 'Unknown Remy tool.' }] };
        }
        try {
          const result = await deps.call(params.name, params.arguments ?? {}, identity);
          const output = result !== null && typeof result === 'object' && !Array.isArray(result)
            ? result as Record<string, unknown> : { result };
          return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
        } catch (error) {
          const e = error as { name?: string; message?: string; status?: number };
          const message = e.name === 'ZodError' ? 'Check the meal fields and keep unknown values null.'
            : e.status && e.status < 500 ? e.message ?? 'Refresh the food log before trying again.'
              : 'Remy could not complete this request. Read the current food log before retrying a save.';
          return { isError: true, content: [{ type: 'text', text: message }] };
        }
      });
      return server;
    }, { maxRequestBodySize: MAX_BYTES, keepAliveMs: 0 });
    return privateResponse(await handler.fetch(request, { parsedBody: parsed }));
  };
}
