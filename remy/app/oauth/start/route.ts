import { appOrigin, authCookieOptions } from '@/lib/supabase/config';
import { assertMcpEnabled } from '@/lib/mcp-auth';
import { authorizationId } from '@/lib/mcp-consent';
import { NextResponse } from 'next/server';
import { failure } from '@/lib/http';
export function GET(request: Request) {
  try {
    assertMcpEnabled();
    const id = authorizationId(new URL(request.url).searchParams.get('authorization_id'));
    const response = NextResponse.redirect(`${appOrigin()}/login`, 303);
    response.cookies.set('remy-oauth-authorization', id, { ...authCookieOptions(), maxAge: 600 });
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch (error) { return failure(error); }
}
