import { cookies } from 'next/headers'
import { DesktopShell } from './DesktopShell'
import { MobileShell } from './MobileShell'

// Which chrome to render is decided server-side, from the `device` cookie
// proxy.ts sets from the real request's User-Agent -- avoids a
// flash-of-wrong-UI that a client-side check (media query, viewport width)
// would cause on first paint.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const isMobile = cookieStore.get('device')?.value === 'mobile'

  return isMobile ? <MobileShell>{children}</MobileShell> : <DesktopShell>{children}</DesktopShell>
}
