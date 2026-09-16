import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Phones get the dedicated mobile UI; tablets (iPad, Android tablets whose
// UA omits the "Mobile" token) fall through to desktop -- they have the
// screen space for the sidebar. Matched on the real device/browser UA
// rather than viewport width, per an explicit product decision: a narrow
// desktop browser window should still get the desktop UI, not the mobile
// one. (Next.js 16 renamed `middleware.ts` to `proxy.ts` -- see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md.)
const MOBILE_UA_REGEX = /iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|IEMobile|Opera Mini/i

export function proxy(request: NextRequest) {
  const ua = request.headers.get('user-agent') ?? ''
  const isMobile = MOBILE_UA_REGEX.test(ua)

  const response = NextResponse.next()
  response.cookies.set('device', isMobile ? 'mobile' : 'desktop', {
    path: '/',
    sameSite: 'lax',
  })
  return response
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
