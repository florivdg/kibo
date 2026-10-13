// The photos offered in several sizes (`<Image widths sizes>`). Their sizes
// are made ahead of time from the master by `bun run images`
// (scripts/responsive-images.ts, Bun.Image): one WebP `<name>-<width>.webp`
// per width next to the master. They are committed — neither the build nor
// the image runs the script —, so after changing a master or a list run it
// again. The image service (./image-service.ts) hands out exactly these
// files, from /_astro/ like any other asset, so a page rendered on demand
// never needs /_image, sharp or Bun at run time; a width without its file
// throws at render time (./image-sizes.ts) rather than claim a size it
// hasn't. A file is a size of a photo only when its master is listed here,
// so an asset that merely ends in a number (`step-2.webp`) stays an ordinary
// image.
//
// No Bun and no Node in here: the script, the image service and the
// components all read it.

export interface ResponsiveImage {
  // The master, relative to the repository: sRGB, no metadata (no EXIF, no
  // ICC profile), which the sizes keep. It must lie under src/assets/: the
  // image service finds the sizes by a glob over that folder
  // (./image-service.ts), so elsewhere its `<Image widths>` would throw at
  // render time; tests/responsive-images.test.ts checks it
  source: string
  widths: number[]
}

// src/components/marketing/Author.astro: 10rem wide, from `sm` 12rem — the
// widths cover 1x, 1.5x, 2x and 3x screens
export const AUTHOR_PHOTO = {
  source: 'src/assets/marketing/florian.jpg',
  widths: [192, 288, 384, 576],
} satisfies ResponsiveImage

export const RESPONSIVE_IMAGES: ResponsiveImage[] = [AUTHOR_PHOTO]

const WEBP = '.webp'

const stem = (source: string) => source.replace(/\.[^./]+$/, '')

// `src/assets/marketing/florian.jpg`, 384 → `src/assets/marketing/florian-384.webp`
export function variantPath(source: string, width: number) {
  return `${stem(source)}-${width}${WEBP}`
}

// The width of `path` if it is one of the sizes of `source`, else undefined;
// with or without the leading `/` import.meta.glob writes
export function variantWidth(source: string, path: string) {
  const file = path.replace(/^\//, '')
  const width = Number(file.slice(stem(source).length + 1, -WEBP.length))
  // The round trip rejects `-0`, `-1e2`, `-old-384` and the like
  if (!Number.isInteger(width) || width <= 0) return undefined
  return variantPath(source, width) === file ? width : undefined
}
