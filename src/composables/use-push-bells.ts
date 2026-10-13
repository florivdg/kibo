import { actions } from 'astro:actions'
import { computed, onMounted, ref } from 'vue'

import { useAnnouncer } from '@/composables/use-announcer'
import { type SubmitResult, useFormSubmit } from '@/composables/use-form-submit'
import { messagesFor, withSpamMessages } from '@/composables/visitor-errors'
import {
  afterSync,
  afterUnsubscribe,
  base64UrlToBytes,
  isAppleMobile,
  latestOnly,
  type PushState,
  sameServerKey,
  stateOnLoad,
} from '@/lib/board/push-client'
import { KITA_SCOPE } from '@/lib/board/paths'
import { HOSTED_PAUSED_VISITOR } from '@/lib/hosted/messages'

const pushErrorMessage = withSpamMessages(
  messagesFor({
    PAYMENT_REQUIRED: HOSTED_PAUSED_VISITOR,
    NOT_FOUND: 'Für dieses Brett sind Benachrichtigungen gerade nicht möglich.',
    BAD_REQUEST: 'Mit diesem Browser klappen Benachrichtigungen leider nicht.',
  }),
)

// What one bell shows (PushBell.vue)
export interface BellState {
  on: boolean
  pending: boolean
  disabled: boolean
  error: string | null
}

function pushSupported() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

// A Safari tab on iPhone and iPad has no push; the Kita added to the home
// screen, opened from there, does
function needsHomeScreen() {
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    matchMedia('(display-mode: standalone)').matches
  return !standalone && isAppleMobile(navigator)
}

function subscriptionBody(subscription: PushSubscription) {
  const { endpoint = '', keys = {} } = subscription.toJSON()
  return {
    endpoint,
    keys: { p256dh: keys.p256dh ?? '', auth: keys.auth ?? '' },
  }
}

// One worker (scope KITA_SCOPE), and one push subscription, for every board
// of every Kita in this browser or installed app. Turning one board off
// therefore only tells the server, unless the endpoint follows no board
// anywhere any more: then the subscription ends as well (switchOff, and a
// sync that hears so). Only looked up, never created: the worker is
// registered once someone switches a bell on.
async function browserSubscription() {
  const registration = await navigator.serviceWorker.getRegistration(KITA_SCOPE)
  return registration ? registration.pushManager.getSubscription() : null
}

// The endpoint notes.create leaves out of the notification about a note
// pinned from here. The server compares it with the board's subscribers, so
// a browser that doesn't follow the board changes nothing.
export async function ownPushEndpoint(): Promise<string | undefined> {
  if (!pushSupported()) return undefined
  const subscription = await browserSubscription().catch(() => null)
  return subscription?.endpoint
}

// The browser's subscription, unless it was made with keys from before a
// rotation: those are useless for every board and are dropped
async function currentSubscription(publicKey: string) {
  const subscription = await browserSubscription()
  if (
    !subscription ||
    sameServerKey(subscription.options.applicationServerKey, publicKey)
  ) {
    return subscription
  }
  await subscription.unsubscribe()
  return null
}

// Every tab of the instance shares that one subscription. Whatever changes
// it in the browser and on the server — a bell switched on or off, a sync
// whose answer can end it — runs under one Web Lock, so one tab can't end
// the subscription while another is subscribing a board with it. Inside the
// lock the subscription is read afresh: another tab may have ended or made
// it while this one waited. Browsers without the Locks API (or outside a
// secure context) run it as it comes.
function withPushLock<T>(change: () => Promise<T>): Promise<T> {
  if (!('locks' in navigator)) return change()
  return navigator.locks.request('kibo-push', change)
}

// Ends the browser's push subscription: its endpoint follows no board any
// more. Gone already, or refused by the browser: the server holds nothing of
// it any more either way.
async function endBrowserSubscription(subscription: PushSubscription) {
  await subscription.unsubscribe().catch(() => false)
}

// The worker, registered on the first switch-on and reused after that
// (registering again returns the same registration). A push subscription
// needs it active.
async function activeWorker() {
  const registration = await navigator.serviceWorker.register('/sw.js', {
    scope: KITA_SCOPE,
    // Updates to the worker must not wait for an HTTP cache
    updateViaCache: 'none',
  })
  const worker = registration.installing ?? registration.waiting
  if (registration.active || !worker) return registration
  await new Promise<void>((resolve, reject) => {
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') resolve()
      else if (worker.state === 'redundant') {
        reject(new Error('Service worker not installed'))
      }
    })
  })
  return registration
}

// A bell went off: if that was the browser's last one anywhere, its push
// subscription ends as well (afterUnsubscribe). Answers the number for the
// app's icon.
async function afterBellOff(
  answer: { unseen: number; remaining: boolean },
  subscription: PushSubscription,
) {
  const { unseen, endBrowserSubscription: end } = afterUnsubscribe(answer)
  if (end) await endBrowserSubscription(subscription)
  return unseen
}

// What push.sync says for this page (afterSync in
// src/lib/board/push-client.ts). A board page sends its board and how far it
// has shown it, which then counts as seen in the number for the app's icon.
// Once the server answers that the endpoint follows no board anywhere any
// more (a renewed link, notifications switched off, boards deleted,
// subscriptions purged), the browser's subscription ends here. Run under the
// push lock.
async function synced(
  kitaToken: string,
  seen: SeenPage | undefined,
  subscription: PushSubscription,
) {
  const answer = await actions.push
    .sync({
      kitaToken,
      seen: seen && { boardId: seen.boardId, until: seen.until() },
      ...subscriptionBody(subscription),
    })
    .then(({ data, error }) => data ?? { errorCode: error?.code })
    .catch(() => ({}))
  const outcome = afterSync(answer)
  if (outcome.endBrowserSubscription) await endBrowserSubscription(subscription)
  return outcome
}

// A board page: its board, and the point in server time it has shown it up
// to (the page's server time, or its newest note) — read afresh for every
// sync
interface SeenPage {
  boardId: string
  until: () => string
}

interface PageOptions {
  // Only on a board page; none on the Kita page
  seen?: SeenPage
  // Takes the number for the app's icon (useAppBadge)
  onUnseen: (count: number) => void
}

// The notification bells of one page of a Kita, all sharing the browser's
// one subscription: the Kita page has one per board, a board page its own.
// Which boards are on is the server's answer to one push.sync per page load;
// nothing is remembered in the browser. No public key: the instance (or, on
// a board page, the board) has notifications off, and no bell shows. The
// sync also answers the number of unseen notes for the app's icon, handed
// to `onUnseen`: 0 where this browser can't be notified, nothing where it
// can't be known. Only the step started last hands its number on
// (latestOnly).
export function usePushBells(
  kitaToken: string,
  publicKey: string | null,
  { seen, onUnseen }: PageOptions,
) {
  // Every step that sets the number for the icon starts with one of these:
  // only the step started last gets through, and an answer that couldn't
  // be had (null) leaves the icon as it is
  const latestBadge = latestOnly(onUnseen)
  function badgeStep() {
    const show = latestBadge()
    return (count: number | null) => {
      if (count !== null) show(count)
    }
  }
  // Decided after mounting: the server renders no bell
  const state = ref<PushState>('hidden')
  const on = ref<ReadonlySet<string>>(new Set())
  // Until the sync has answered, no bell can be switched: it could be
  // overtaken by the answer
  const syncing = ref(false)
  // One switch at a time: they all go through the one subscription. Its
  // pending state and error belong to the board last switched.
  const { pending, error, run } = useFormSubmit(pushErrorMessage)
  const switchedBoardId = ref<string | null>(null)
  const busy = computed(() => syncing.value || pending.value)
  const { status, announce } = useAnnouncer()

  function setOn(boardId: string, value: boolean, boardName: string) {
    const next = new Set(on.value)
    if (value) next.add(boardId)
    else next.delete(boardId)
    on.value = next
    void announce(
      `Benachrichtigungen für „${boardName}“ sind ${value ? 'an' : 'aus'}.`,
    )
  }

  function showSynced(boardIds: string[] | null) {
    if (boardIds) on.value = new Set(boardIds)
    else state.value = 'hidden'
  }

  async function sync(key: string) {
    const showUnseen = badgeStep()
    const answer = await withPushLock(async () => {
      const subscription = await currentSubscription(key).catch(() => undefined)
      // Service workers refused (e.g. some private windows): no bells
      if (subscription === undefined) return null
      // Nothing the server could know of: every bell is off, and no
      // notification can come that the icon would count
      if (!subscription || Notification.permission !== 'granted') {
        return { boardIds: [], unseen: 0 }
      }
      return synced(kitaToken, seen, subscription)
    })
    if (!answer) return showSynced(null)
    showSynced(answer.boardIds)
    showUnseen(answer.unseen)
  }

  // Bells are shown and notifications allowed
  function notifiable() {
    return state.value === 'ready' && Notification.permission === 'granted'
  }

  // A board page's „Neu“ mark moved (a note of its own, new notes after a tap
  // on a notification): sync once more with the board, so they are seen, and
  // show what is left. The bells stay as they are — unless the browser's
  // subscription just ended (synced), which leaves every bell off.
  async function recount() {
    if (!notifiable()) return
    const showUnseen = badgeStep()
    const answer = await withPushLock(async () => {
      const subscription = await browserSubscription().catch(() => null)
      return subscription && synced(kitaToken, seen, subscription)
    })
    if (!answer) return
    if (answer.endBrowserSubscription) showSynced([])
    showUnseen(answer.unseen)
  }

  // No bells to sync: no notification can reach this browser (no push here,
  // the permission denied, …), so the icon shows none. Except on a board
  // page without a key: only that board has notifications off.
  function unsynced() {
    if (publicKey || !seen) badgeStep()(0)
  }

  onMounted(async () => {
    state.value = stateOnLoad({
      publicKey: !!publicKey,
      needsHomeScreen: needsHomeScreen(),
      supported: pushSupported(),
      permission: pushSupported() ? Notification.permission : 'default',
    })
    if (state.value !== 'ready' || !publicKey) return unsynced()
    syncing.value = true
    try {
      await sync(publicKey)
    } finally {
      syncing.value = false
    }
  })

  // The permission prompt comes straight from the tap, before anything else
  // is awaited (the push lock included): Safari only shows it for a user
  // gesture. Once granted, the next bells don't ask again. The worker is
  // only registered once the permission is there.
  async function switchOn(
    boardId: string,
    boardName: string,
    key: string,
  ): Promise<SubmitResult> {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      if (permission === 'denied') state.value = 'blocked'
      return {}
    }
    const result = await withPushLock(async () => {
      const registration = await activeWorker()
      // The browser's subscription as it is now, or a new one
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(key),
      })
      return actions.push.subscribe({
        kitaToken,
        boardId,
        ...subscriptionBody(subscription),
      })
    })
    if (!result.error) setOn(boardId, true, boardName)
    return result
  }

  async function switchOff(
    boardId: string,
    boardName: string,
  ): Promise<SubmitResult> {
    const error = await withPushLock(async () => {
      const subscription = await browserSubscription()
      return subscription ? unsubscribe(boardId, subscription) : undefined
    })
    if (error) return { error }
    setOn(boardId, false, boardName)
    return {}
  }

  // The board's notes no longer count on the app's icon. Was it the
  // browser's last bell, the browser unsubscribes from its push service as
  // well (afterBellOff). NOT_FOUND: the board or its notifications are gone,
  // so nothing is sent anyway, and the bell goes off; one sync (without a
  // board seen) then tells whether the endpoint follows anything else and
  // ends the browser's subscription if not — unless the Kita link itself
  // was renewed, which answers NOT_FOUND again and leaves it be. The service
  // worker stays registered: it serves every Kita of the instance in this
  // browser, holds nothing and does nothing without a subscription; the
  // next bell simply reuses it. Run under the push lock.
  async function unsubscribe(boardId: string, subscription: PushSubscription) {
    const showUnseen = badgeStep()
    const { data, error } = await actions.push.unsubscribe({
      kitaToken,
      boardId,
      endpoint: subscription.endpoint,
    })
    if (data) showUnseen(await afterBellOff(data, subscription))
    if (error?.code !== 'NOT_FOUND') return error
    showUnseen((await synced(kitaToken, undefined, subscription)).unseen)
    return undefined
  }

  // Called straight from the tap: switchOn asks for the permission before
  // anything else is awaited
  function switchBell(boardId: string, boardName: string, key: string) {
    return on.value.has(boardId)
      ? switchOff(boardId, boardName)
      : switchOn(boardId, boardName, key)
  }

  // A browser that refuses to subscribe fails like a request that does
  // (useFormSubmit)
  async function toggle(boardId: string, boardName: string) {
    if (busy.value || !publicKey) return
    switchedBoardId.value = boardId
    await run(() => switchBell(boardId, boardName, publicKey))
  }

  // What one bell needs to know. Disabled while the sync is out, or while
  // another bell is being switched.
  function bell(boardId: string): BellState {
    const switched = switchedBoardId.value === boardId
    return {
      on: on.value.has(boardId),
      pending: switched && pending.value,
      disabled: busy.value,
      error: switched ? error.value : null,
    }
  }

  return { state, status, bell, toggle, recount }
}
