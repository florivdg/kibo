import type { Session } from '@/lib/auth'
import type { KitaOwnerSubscription } from '@/lib/hosted/access'
import type { SubscriptionNotice } from '@/lib/hosted/notice'

declare global {
  namespace App {
    interface Locals {
      user?: Session['user']
      session?: Session['session']
      // Active Kita, verified as a current membership by the middleware.
      // Always set on admin pages except /admin/organizations/new.
      organizationId?: string
      // On admin pages of the hosted instance: who answers for the active
      // Kita, with the dates of their subscription; what the layout says
      // about it (null or missing: nothing), and whether that Kita is paused.
      // Looked up once by the middleware.
      kitaOwner?: KitaOwnerSubscription
      subscriptionNotice?: SubscriptionNotice | null
      kitaPaused?: boolean
    }
  }
}

export {}
