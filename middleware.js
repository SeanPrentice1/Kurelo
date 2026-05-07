export const config = {
  matcher: ['/dashboard', '/dashboard/:path*', '/api/health', '/api/stripe', '/api/posthog', '/api/crevaxo', '/api/rostura', '/api/email', '/api/agents/:path*'],
}

export default function middleware(request) {
  const { pathname } = new URL(request.url)

  // Allow login page and auth endpoint through without a session check
  if (
    pathname === '/dashboard/login.html' ||
    pathname === '/dashboard/login' ||
    pathname === '/api/auth'
  ) {
    return
  }

  const cookieHeader = request.headers.get('cookie') || ''
  const sessionToken = process.env.DASHBOARD_SESSION_TOKEN

  if (sessionToken && cookieHeader.includes(`dashboard_session=${sessionToken}`)) {
    return
  }

  return Response.redirect(new URL('/dashboard/login.html', request.url), 302)
}
