import { oauthMetadata, oauthFailure, oauthJson } from '@/lib/mcp-oauth';
export const dynamic = 'force-dynamic';
export function GET() { try { return oauthJson(oauthMetadata()); } catch (error) { return oauthFailure(error); } }
