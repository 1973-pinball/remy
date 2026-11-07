import { exchangeOAuth, oauthFailure } from '@/lib/mcp-oauth';
export async function POST(request: Request) { try { return await exchangeOAuth(request); } catch (error) { return oauthFailure(error); } }
