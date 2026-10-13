import { nextTick, ref } from 'vue'

// A message for a role="status" region, for changes screen readers wouldn't
// notice otherwise
export function useAnnouncer() {
  const status = ref('')

  async function announce(message: string) {
    // Cleared first, so the same message is read out again
    status.value = ''
    await nextTick()
    status.value = message
  }

  return { status, announce }
}
