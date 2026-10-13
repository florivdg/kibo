import type { ImageMetadata, ImageTransform } from 'astro'

import {
  RESPONSIVE_IMAGES,
  type ResponsiveImage,
  variantWidth,
} from '@/lib/images/responsive'

// How the image service (./image-service.ts) points `<Image widths>` at the
// sizes of a photo listed in ./responsive.ts: each width asked for is the file
// of that width, and the srcset names the file's own width. No glob in here,
// so the tests call it as it is.

type Sizes = ReadonlyMap<number, ImageMetadata>

// The sizes of every listed photo, by the URL of each of its files — Astro
// hands the service a copy of the imported metadata, so the URL is what
// identifies a file. Files of no listed photo are left out.
export function sizesIndex(
  files: Record<string, ImageMetadata>,
  photos: readonly ResponsiveImage[] = RESPONSIVE_IMAGES,
) {
  const byURL = new Map<string, Sizes>()
  for (const { source } of photos) {
    const sizes = new Map<number, ImageMetadata>()
    for (const [path, image] of Object.entries(files)) {
      if (variantWidth(source, path) === undefined) continue
      sizes.set(image.width, image)
      byURL.set(image.src, sizes)
    }
  }
  return byURL
}

type SizesIndex = ReturnType<typeof sizesIndex>

function sizeOf(sizes: Sizes, width: number | undefined) {
  const image = width === undefined ? undefined : sizes.get(width)
  if (!image) {
    const made = [...sizes.keys()].sort((a, b) => a - b).join(', ')
    throw new Error(
      `Kein Bild mit ${width} px Breite (vorhanden: ${made}) – Breite in src/lib/images/responsive.ts eintragen und \`bun run images\` ausführen`,
    )
  }
  return image
}

// The address of an image at the width asked for: the file of that width for
// a photo that comes in sizes, otherwise the file as it is
export function sizedURL(
  index: SizesIndex,
  { src, width }: Pick<ImageTransform, 'src' | 'width'>,
) {
  if (typeof src === 'string') return src
  const sizes = index.get(src.src)
  return sizes ? sizeOf(sizes, width).src : src.src
}

const ONLY_LISTED_WIDTHS =
  'Nur Bilder aus `bun run images` haben Größen, und nur als `widths`'

// The srcset of `widths`: one file per width, named by its real width
export function sizedSrcSet(index: SizesIndex, options: ImageTransform) {
  if (options.densities?.length) throw new Error(ONLY_LISTED_WIDTHS)
  if (!options.widths?.length) return []
  const { src } = options
  const sizes = typeof src === 'string' ? undefined : index.get(src.src)
  if (!sizes) throw new Error(ONLY_LISTED_WIDTHS)
  return [...new Set(options.widths)]
    .sort((a, b) => a - b)
    .map((width) => {
      const image = sizeOf(sizes, width)
      return {
        transform: { ...options, width: image.width, height: image.height },
        descriptor: `${image.width}w`,
        attributes: { type: 'image/webp' },
      }
    })
}
