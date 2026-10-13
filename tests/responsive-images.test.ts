import { describe, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  RESPONSIVE_IMAGES,
  variantPath,
  variantWidth,
} from '@/lib/images/responsive'

// The sizes `bun run images` makes are committed, and the image service
// (src/lib/images/image-service.ts) hands out a width only if its file is
// there: each listed width has its file, of that width, and nothing else.
const ROOT = join(import.meta.dir, '..')

describe.each(RESPONSIVE_IMAGES)('$source', ({ source, widths }) => {
  test.each(widths)('has its %d px file', async (width) => {
    const file = Bun.file(join(ROOT, variantPath(source, width)))
    const image = new Bun.Image(await file.bytes())
    const master = await new Bun.Image(join(ROOT, source)).metadata()
    expect(await image.metadata()).toEqual({
      width,
      height: Math.round((width * master.height) / master.width),
      format: 'webp',
    })
    // No EXIF, XMP or colour profile chunk
    expect(await file.text()).not.toMatch(/EXIF|XMP |ICCP/)
  })

  test('has its master under src/assets/', () => {
    // The image service's glob only sees sizes there
    expect(source.startsWith('src/assets/')).toBe(true)
  })

  test('has a master without metadata', async () => {
    // Walk the JPEG markers up to the scan: APP0 (JFIF) only, no APP1–APP15
    // (EXIF, XMP, ICC profile and the like)
    const bytes = await Bun.file(join(ROOT, source)).bytes()
    const markers: number[] = []
    let offset = 2
    while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1]
      if (marker === 0xda) break
      markers.push(marker)
      offset += 2 + ((bytes[offset + 2] << 8) | bytes[offset + 3])
    }
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8])
    expect([bytes[offset], bytes[offset + 1]]).toEqual([0xff, 0xda])
    expect(markers.filter((m) => m >= 0xe1 && m <= 0xef)).toEqual([])
  })

  test('has no file of a width not listed', async () => {
    const directory = dirname(source)
    const made = (await readdir(join(ROOT, directory)))
      .map((file) => variantWidth(source, join(directory, file)))
      .filter((width) => width !== undefined)
    const byWidth = (a: number, b: number) => a - b
    expect(made.sort(byWidth)).toEqual([...widths].sort(byWidth))
  })
})

describe('variantWidth', () => {
  const source = 'src/assets/a/photo.jpg'

  test('reads the width of a size, as the glob or the script names it', () => {
    expect(variantWidth(source, variantPath(source, 384))).toBe(384)
    expect(variantWidth(source, '/src/assets/a/photo-384.webp')).toBe(384)
  })

  test('is undefined for any other file', () => {
    for (const path of [
      'src/assets/a/photo.jpg',
      'src/assets/a/photo-384.png',
      'src/assets/a/photo-0.webp',
      'src/assets/a/photo-1e2.webp',
      'src/assets/a/photo-old-384.webp',
      'src/assets/a/step-2.webp',
      'src/assets/b/photo-384.webp',
    ]) {
      expect(variantWidth(source, path)).toBeUndefined()
    }
  })
})
