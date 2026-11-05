import type { Ref } from 'vue'

// After a 2FA code was checked (useFormSubmit's run): a rejected code is
// cleared for the next try. The answer can come after the input moved on,
// to another code or another method; it is about what was sent, so it then
// neither clears nor judges what is there now.
export function settleCodeCheck(
  passed: boolean,
  error: Ref<string | null>,
  code: Ref<string>,
  sentIsShown: boolean,
) {
  if (passed || !error.value) return
  if (sentIsShown) code.value = ''
  else error.value = null
}
