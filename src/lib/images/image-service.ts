import type { ExternalImageService, ImageMetadata } from 'astro'
import { baseService } from 'astro/assets'

import { sizedSrcSet, sizedURL, sizesIndex } from '@/lib/images/image-sizes'

// The images Astro handles — the screenshots in the documentation and the
// photos of ./responsive.ts — are optimised WebP files already, so they go out
// as the files Vite copies to /_astro/: no sharp, and no /_image endpoint
// doing work on every request — which is what Astro's own pass-through
// service still does for a page rendered on demand. An "external" service is
// one that only says where an image lives. Vite resolves the service like any
// module, so the glob is filled in at build time; sizesIndex keeps only the
// sizes of listed photos.
const sizes = sizesIndex(
  import.meta.glob<ImageMetadata>('/src/assets/**/*-[0-9]*.webp', {
    eager: true,
    import: 'default',
  }),
)

const service: ExternalImageService = {
  validateOptions: baseService.validateOptions,
  // width, height, loading="lazy", decoding="async", sizes
  getHTMLAttributes: baseService.getHTMLAttributes,
  getURL: (options) => sizedURL(sizes, options),
  getSrcSet: (options) => sizedSrcSet(sizes, options),
}

export default service
