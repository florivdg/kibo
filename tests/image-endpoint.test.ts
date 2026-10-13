import { expect, test } from 'bun:test'

import { GET } from '@/lib/images/image-endpoint'

// Astro's own endpoint answers 500 here, with a line in the error log
test('/_image answers 404 with nothing in it', async () => {
  const response = await GET({} as never)
  expect(response.status).toBe(404)
  expect(response.statusText).toBe('Not Found')
  expect(await response.text()).toBe('')
})
