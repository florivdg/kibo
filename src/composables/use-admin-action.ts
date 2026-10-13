import { toastError } from '@/components/admin/toast'
import {
  useFormSubmit,
  type RunOptions,
  type SubmitResult,
} from '@/composables/use-form-submit'

// For admin actions triggered outside a form: errors show up as a toast
export function useAdminAction() {
  const { error, pending, run } = useFormSubmit()

  async function runWithToast<T extends SubmitResult>(
    action: () => Promise<T>,
    options?: RunOptions<T>,
  ) {
    const ok = await run(action, options)
    if (!ok && error.value) toastError(error.value)
    return ok
  }

  return { pending, run: runWithToast }
}
