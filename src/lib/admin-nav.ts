import { SUBSCRIPTION_PATH } from '@/lib/auth-paths'
import { REPORTS_PATH } from '@/lib/reports/paths'

// What the admin sidebar lists under „Verwaltung“
// (src/components/admin/AppSidebar.vue, which adds the icons). „Abo“ is
// there on the hosted instance only — everywhere else the page answers 404.
const ITEMS = [
  { id: 'dashboard', title: 'Dashboard', url: '/admin' },
  { id: 'boards', title: 'Bretter', url: '/admin/boards' },
  { id: 'reports', title: 'Meldungen', url: REPORTS_PATH },
  { id: 'kita', title: 'Kita-Einstellungen', url: '/admin/kita' },
  { id: 'subscription', title: 'Abo', url: SUBSCRIPTION_PATH },
] as const

export type AdminNavId = (typeof ITEMS)[number]['id']

// The boards and the reports are sections with pages of their own; every
// other entry is a page
const SECTIONS = new Set<AdminNavId>(['boards', 'reports'])

// What aria-current says: the entry's own page, or a page within its section
function currentOf(id: AdminNavId, url: string, path: string) {
  if (path === url) return 'page' as const
  if (SECTIONS.has(id) && path.startsWith(url)) return 'true' as const
  return undefined
}

export function adminNavigation(
  currentPath: string,
  { hosted }: { hosted: boolean },
) {
  const path = currentPath.replace(/\/$/, '')
  return ITEMS.filter(({ id }) => hosted || id !== 'subscription').map(
    (item) => ({ ...item, current: currentOf(item.id, item.url, path) }),
  )
}
