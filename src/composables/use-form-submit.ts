import { ref } from 'vue'

import { authErrorMessage } from '@/lib/auth-errors'

export interface SubmitError {
  code?: string
  status?: number
  // Some server errors carry a ready-made German message, e.g. the wait time
  // of a spam limit
  message?: string
}

export interface SubmitResult {
  error?: SubmitError | null
}

// Where a success takes the browser: another page, or the same one afresh.
// `redirected` is for calls that already sent it on themselves (the 2FA
// sign-in). `toast` is a success message for the next admin page.
export type Leave = (
  { href: string } | { reload: true } | { redirected: true }
) & {
  toast?: string
}

export interface RunOptions<T> {
  // Leaving keeps the form pending until the next page is there, so a second
  // click can't send it again. A function decides from the result; undefined
  // stays on the page.
  leave?: Leave | ((result: T) => Leave | undefined)
}

const FLASH_KEY = 'kibo:flash'

function toastOnNextPage(message: string) {
  try {
    sessionStorage.setItem(FLASH_KEY, message)
  } catch {
    // Storage can be off; the change itself went through all the same
  }
}

// The message a leaving form left behind; AdminToaster shows it once the next
// page is up
export function takeNextPageToast(): string | null {
  try {
    const message = sessionStorage.getItem(FLASH_KEY)
    sessionStorage.removeItem(FLASH_KEY)
    return message
  } catch {
    return null
  }
}

// Tracks pending state and a German error message for a better-auth call or
// an Astro action (both resolve to a result with an optional error).
// Resolves to the result when the call succeeded, undefined otherwise.
export function useFormSubmit(messageFor = authErrorMessage) {
  const error = ref<string | null>(null)
  // The raw code next to the message, for forms that offer a way out of a
  // specific failure
  const errorCode = ref<string | null>(null)
  const pending = ref(false)

  function leavePage(to: Leave) {
    // Coming back through the history can restore the page as it was left,
    // pending included
    window.addEventListener(
      'pageshow',
      (event) => {
        if (event.persisted) pending.value = false
      },
      { once: true },
    )
    if (to.toast) toastOnNextPage(to.toast)
    if ('href' in to) window.location.href = to.href
    else if ('reload' in to) window.location.reload()
  }

  function fail(failure: SubmitError) {
    error.value = messageFor(failure)
    errorCode.value = failure.code ?? null
  }

  // A check of the form itself failed before anything was sent: the message,
  // and a code of the form's own that tells which field it is about
  function refuse(code: string, message: string) {
    error.value = message
    errorCode.value = code
  }

  // The result on success; otherwise the error is recorded and undefined
  async function settle<T extends SubmitResult>(action: () => Promise<T>) {
    try {
      const result = await action()
      if (!result.error) return result
      fail(result.error)
    } catch {
      // Network failures reject instead of returning an error result
      fail({})
    }
  }

  // A call while another one runs is dropped (a double click, or a code
  // input completing again) and resolves to undefined
  async function run<T extends SubmitResult>(
    action: () => Promise<T>,
    { leave }: RunOptions<T> = {},
  ): Promise<T | undefined> {
    if (pending.value) return
    error.value = null
    errorCode.value = null
    pending.value = true
    const result = await settle(action)
    const to = result && (typeof leave === 'function' ? leave(result) : leave)
    if (to) leavePage(to)
    else pending.value = false
    return result
  }

  return { error, errorCode, pending, refuse, run }
}
