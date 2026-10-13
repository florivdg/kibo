// What the controls of the board's dialogs and pages share; each button adds
// its colours and weight, like the buttons of the start page
// (src/components/marketing/classes.ts).

// A text field of the note and the report form. The border at /60 is the
// field's outline for anyone who can't tell it from the white of the dialog
// otherwise (3.8:1); focused, it darkens and gets the outline every control
// of the board has.
export const textFieldClass =
  'mt-1.5 w-full rounded-2xl border-2 border-tinte/60 bg-white px-4 py-3 text-base text-tinte placeholder:text-tinte/70 focus:border-tinte focus:outline-3 focus:outline-offset-2 focus:outline-tinte'

// A round button. A busy one only says it is disabled (aria-disabled), so it
// keeps the focus; its click handler drops a second click.
export const pillButtonClass =
  'focus-visible:outline-tinte rounded-full px-6 py-3 text-base focus-visible:outline-3 focus-visible:outline-offset-2 aria-disabled:cursor-wait aria-disabled:opacity-70'

// The round 44 px button of the board's bar and of a bell: an icon, and
// whatever border and background its caller gives it
export const roundButtonClass =
  'focus-visible:outline-tinte inline-flex size-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-3 focus-visible:outline-offset-2'

// A link inside the text of a dialog: the privacy policy, the operator's
// address
export const inlineLinkClass =
  'focus-visible:outline-tinte rounded-sm underline underline-offset-4 hover:no-underline focus-visible:outline-3 focus-visible:outline-offset-2'

// A choice of the report form, radio or checkbox, framed like a card
export const reportOptionClass =
  'flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-tinte/15 px-4 py-3 font-semibold has-checked:border-tinte has-checked:bg-tinte/5 has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-tinte'
