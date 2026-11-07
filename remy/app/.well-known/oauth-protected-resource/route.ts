import { mcpMetadata, mcpAuthFailure } from '@/lib/mcp-auth';
export const dynamic = 'force-dynamic';
export function GET() {
  try { return Response.json(mcpMetadata(), { headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } }); }
  catch (error) { return mcpAuthFailure(error); }
}
