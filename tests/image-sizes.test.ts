import { describe, expect, test } from 'bun:test'

import type { ImageMetadata, ImageTransform } from 'astro'

import { sizedSrcSet, sizedURL, sizesIndex } from '@/lib/images/image-sizes'

// How the image service (src/lib/images/image-service.ts) points `<Image>` at
// the sizes `bun run images` made, given what its glob would find
const file = (name: string, width: number): ImageMetadata => ({
  src: `/_astro/${name}.HASH.webp`,
  width,
  height: width,
  format: 'webp',
})
const PHOTO = { 192: file('photo-192', 192), 576: file('photo-576', 576) }
const SCREENSHOT = file('screenshot', 1280)
const STEP = file('step-2', 2)
const index = sizesIndex(
  {
    '/src/assets/a/photo-192.webp': PHOTO[192],
    '/src/assets/a/photo-576.webp': PHOTO[576],
    '/src/assets/b/photo-384.webp': file('other-384', 384),
    '/src/assets/a/step-2.webp': STEP,
  },
  [
    { source: 'src/assets/a/photo.png', widths: [192, 576] },
    { source: 'src/assets/b/photo.png', widths: [384] },
  ],
)
// Astro hands the service a copy of the imported metadata
const copy = (image: ImageMetadata) => ({ ...image })

describe('sizedURL', () => {
  test('is the file of the width asked for', () => {
    const src = copy(PHOTO[576])
    expect(sizedURL(index, { src, width: 192 })).toBe(PHOTO[192].src)
    expect(sizedURL(index, { src, width: 576 })).toBe(PHOTO[576].src)
  })

  test('refuses a width without its file', () => {
    expect(() =>
      sizedURL(index, { src: copy(PHOTO[576]), width: 384 }),
    ).toThrow('Kein Bild mit 384 px Breite (vorhanden: 192, 576)')
  })

  test('leaves an image without sizes as it is', () => {
    expect(sizedURL(index, { src: SCREENSHOT, width: 1280 })).toBe(
      SCREENSHOT.src,
    )
    expect(sizedURL(index, { src: '/x.webp', width: 10 })).toBe('/x.webp')
  })

  test('takes only the sizes of a listed photo', () => {
    // Its glob matches it, but no photo named `step` is listed
    expect(sizedURL(index, { src: copy(STEP), width: 1280 })).toBe(STEP.src)
    expect(sizedURL(index, { src: copy(PHOTO[576]), width: 192 })).toBe(
      PHOTO[192].src,
    )
  })
})

describe('sizedSrcSet', () => {
  const options = (extra: Partial<ImageTransform>): ImageTransform => ({
    src: copy(PHOTO[576]),
    width: 192,
    height: 192,
    format: 'webp',
    ...extra,
  })

  test('names each file by its own width', () => {
    const srcSet = sizedSrcSet(index, options({ widths: [576, 192, 576] }))
    expect(
      srcSet.map(({ transform, descriptor }) => [
        sizedURL(index, transform),
        descriptor,
        transform.height,
      ]),
    ).toEqual([
      [PHOTO[192].src, '192w', 192],
      [PHOTO[576].src, '576w', 576],
    ])
    expect(srcSet[0]?.attributes).toEqual({ type: 'image/webp' })
  })

  test('is empty without widths', () => {
    expect(sizedSrcSet(index, options({}))).toEqual([])
    expect(sizedSrcSet(index, { src: SCREENSHOT, width: 1280 })).toEqual([])
  })

  test('refuses what it has no files for', () => {
    expect(() => sizedSrcSet(index, options({ widths: [192, 384] }))).toThrow(
      'Kein Bild mit 384 px Breite',
    )
    expect(() => sizedSrcSet(index, options({ densities: [1, 2] }))).toThrow(
      'nur als `widths`',
    )
    expect(() =>
      sizedSrcSet(index, { src: SCREENSHOT, width: 1280, widths: [640] }),
    ).toThrow('Nur Bilder aus `bun run images`')
  })
})
