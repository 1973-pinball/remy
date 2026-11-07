import { beginOAuth, oauthFailure } from '@/lib/mcp-oauth';
export async function GET(request: Request) { try { return await beginOAuth(request); } catch (error) { return oauthFailure(error); } }
