import { kitaPath } from './paths'

// Every Kita is one web app: on iOS that is what adding it to the home screen
// makes of it, and only such an app may receive push there. Its id, start and
// scope are the Kita page /k/<token>/, whichever of its pages it was added
// from, so the app always opens on every board of the Kita and keeps its
// boards inside; the narrow scope keeps two Kitas apart. Name is the Kita's,
// the icons are shared (public/icons/).

// Launchers cut longer names off anyway, and not where one would
const SHORT_NAME_MAX = 15
// The board page's paper colour (--color-filz in src/styles/frontend.css),
// also the theme colour of every frontend page (FrontendHead.astro)
export const PAPER_COLOR = '#c9dbe6'

// "Elternbeirat Sonnenschein" becomes "Elternbeirat…": cut after the last
// whole word that fits next to the ellipsis. Only when that leaves too little
// (a single long word, or a short first one) is a word cut.
function shortName(name: string) {
  const chars = Array.from(name.trim())
  if (chars.length <= SHORT_NAME_MAX) return chars.join('')
  const room = chars.slice(0, SHORT_NAME_MAX)
  const space = room.findLastIndex((char) => /\s/.test(char))
  const keep = space >= SHORT_NAME_MAX / 2 ? space : SHORT_NAME_MAX - 1
  return `${room.slice(0, keep).join('').trimEnd()}…`
}

export function kitaManifest(kitaToken: string, name: string) {
  const path = kitaPath(kitaToken)
  return {
    id: path,
    name,
    short_name: shortName(name),
    start_url: path,
    scope: path,
    display: 'standalone',
    lang: 'de',
    background_color: PAPER_COLOR,
    theme_color: PAPER_COLOR,
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
