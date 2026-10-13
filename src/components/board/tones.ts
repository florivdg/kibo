import type { NoteTone } from '@/lib/board/types'

// Full class names so Tailwind picks them up
export const paperClass: Record<NoteTone, string> = {
  sonne: 'bg-sonne',
  gras: 'bg-gras',
  rosa: 'bg-rosa',
  flieder: 'bg-flieder',
}

const TILTS = [
  '-rotate-1',
  'rotate-[0.6deg]',
  'rotate-1',
  '-rotate-[0.6deg]',
  'rotate-[0.3deg]',
  '-rotate-[0.8deg]',
]
const PINS = ['bg-kirsche', 'bg-tinte', 'bg-kirsche', 'bg-white']

function hash(id: string) {
  let value = 0
  for (const char of id) value = (value * 31 + char.charCodeAt(0)) >>> 0
  return value
}

// Stable per note, so server and client render the same tilt and pin
export function noteTilt(id: string) {
  return TILTS[hash(id) % TILTS.length]
}

export function notePin(id: string) {
  return PINS[hash(id + 'pin') % PINS.length]
}
