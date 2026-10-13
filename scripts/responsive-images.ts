// `bun run images`: writes the sizes of the photos listed in
// src/lib/images/responsive.ts (what they are for, and why they are
// committed, is said there) and deletes the file of a width no longer listed,
// since the image service would offer it. Bun.Image's own codecs
// (`backend = 'bun'`) give the same bytes on every platform, so a second run
// changes nothing git would see.
import { readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  RESPONSIVE_IMAGES,
  type ResponsiveImage,
  variantPath,
  variantWidth,
} from '@/lib/images/responsive'

const ROOT = join(import.meta.dir, '..')
const QUALITY = 80

async function writeVariants({ source, widths }: ResponsiveImage) {
  const master = await Bun.file(join(ROOT, source)).bytes()
  const { width: masterWidth } = await new Bun.Image(master).metadata()
  // A larger file would only be the master blown up
  const tooWide = widths.filter((width) => width > masterWidth)
  if (tooWide.length) {
    throw new Error(
      `${source} ist nur ${masterWidth} px breit, nicht ${tooWide.join(', ')}`,
    )
  }
  await Promise.all(
    widths.map(async (width) => {
      const target = variantPath(source, width)
      const bytes = await new Bun.Image(master)
        .resize(width)
        .webp({ quality: QUALITY })
        .bytes()
      await Bun.write(join(ROOT, target), bytes)
      console.log(`geschrieben  ${target}`)
    }),
  )
}

async function removeUnlisted({ source, widths }: ResponsiveImage) {
  const directory = dirname(source)
  for (const file of await readdir(join(ROOT, directory))) {
    const path = join(directory, file)
    const width = variantWidth(source, path)
    if (width !== undefined && !widths.includes(width)) {
      await rm(join(ROOT, path))
      console.log(`gelöscht     ${path}`)
    }
  }
}

Bun.Image.backend = 'bun'
for (const image of RESPONSIVE_IMAGES) {
  await writeVariants(image)
  await removeUnlisted(image)
}
