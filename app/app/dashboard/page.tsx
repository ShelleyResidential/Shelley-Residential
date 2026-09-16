import { cookies } from 'next/headers'
import { DesktopDashboardPage } from './DesktopDashboardPage'
import { MobileDashboardPage } from './MobileDashboardPage'

// Same split as the layout: which UI to render is decided server-side from
// the `device` cookie proxy.ts sets, so there's no flash of the wrong
// version on first paint.
export default async function DashboardPage() {
  const cookieStore = await cookies()
  const isMobile = cookieStore.get('device')?.value === 'mobile'

  return isMobile ? <MobileDashboardPage /> : <DesktopDashboardPage />
}
