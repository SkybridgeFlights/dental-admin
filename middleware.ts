import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type CookieToSet = { name: string; value: string; options?: object };

// Runs once per cold start — catches config problems before any request is served
function assertEnv() {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    console.error('[middleware] ❌ NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing. Check .env.local');
    return;
  }

  try {
    const urlId  = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
    const jwtRef = JSON.parse(Buffer.from(anon.split('.')[1], 'base64url').toString()).ref;
    if (urlId !== jwtRef) {
      console.error(`[middleware] ❌ Project ID mismatch — URL has "${urlId}" but anon JWT has "${jwtRef}". Fix NEXT_PUBLIC_SUPABASE_URL in .env.local`);
    } else {
      console.info(`[middleware] ✅ Supabase project ID confirmed: ${urlId}`);
    }
  } catch {
    console.error('[middleware] ❌ Could not decode NEXT_PUBLIC_SUPABASE_ANON_KEY — is it a valid JWT?');
  }
}
assertEnv();

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Refresh the session cookie on every request so it doesn't expire mid-session
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: CookieToSet[]) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Validate session — do not rely on the cookie value alone
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Protect all /dashboard routes
  if (pathname.startsWith('/dashboard') && !user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Redirect authenticated users away from the login page
  if (pathname === '/login' && user) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    // Run on all routes except Next.js internals and static files
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)',
  ],
};
