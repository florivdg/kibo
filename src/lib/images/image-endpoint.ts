import type { APIRoute } from 'astro'

export const prerender = false

// The image service (./image-service.ts) serves every image from /_astro/, so
// nothing ever links to /_image. The endpoint exists only because Astro
// injects the route whatever the service is, and its own one would answer 500
// and write an error to the log for every request.
export const GET: APIRoute = () =>
  new Response(null, { status: 404, statusText: 'Not Found' })
