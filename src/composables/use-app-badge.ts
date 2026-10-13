import { showAppBadge } from '@/lib/board/push-client'

// The number on the icon of the installed Kita app (src/lib/push/unseen.ts),
// set by the page's island alone: the bells hand it what the server counted
// (push.sync, push.unsubscribe) or 0 where this browser can't be notified,
// and the Kita page clears it when the instance has no push at all. Nothing
// happens where the browser has no badges. A paused Kita's pages have no
// island, so the icon stays as it was there.
export function useAppBadge() {
  return {
    show(count: number) {
      void showAppBadge(navigator, count)
    },
  }
}
