// What the start page (src/pages/index.astro) and the sections of the hosted
// instance below it share, so the button next to the price is the one in the
// header, and what those sections share among themselves.

// A button of the start page; each kind adds its colours
export const ctaClass =
  'focus-visible:outline-tinte rounded-full px-6 py-3 text-lg font-bold focus-visible:outline-3 focus-visible:outline-offset-3'
// The one that leads
export const primaryCtaClass = 'bg-kirsche hover:bg-kirsche/90 text-white'

// A link in the text of a section
export const linkClass =
  'focus-visible:outline-tinte font-bold underline underline-offset-4 hover:no-underline focus-visible:outline-3 focus-visible:outline-offset-3'

// Heading and text of a note in the sections of the hosted instance. They
// read like the feature notes of the start page, which keep their classes in
// their own markup: that page renders without HOSTED as it always has, byte
// for byte.
export const cardTitleClass = 'text-xl leading-snug font-bold text-balance'
export const cardBodyClass = 'mt-2 leading-relaxed'
