import { revokeOAuth, oauthFailure } from '@/lib/mcp-oauth';
export async function POST(request: Request) { try { return await revokeOAuth(request); } catch (error) { return oauthFailure(error); } }
