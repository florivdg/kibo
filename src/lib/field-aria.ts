// The ARIA of a form field. `error`: the id of the FormError that is about
// this field right now (false or undefined while it isn't), which marks it
// invalid; `hint`: the id of its FieldDescription. Both describe the field,
// the error first.
export function fieldAria({
  error,
  hint,
}: {
  error?: string | false
  hint?: string
}) {
  const describedBy = [error, hint].filter(Boolean).join(' ')
  return {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
  }
}
