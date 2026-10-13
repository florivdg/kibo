// Waits for work under way at SIGTERM, but no longer than the server waits for
// its requests (src/lib/server/runtime.ts); whatever is still running then is
// left to the process's exit
export async function settleWithin(work: Promise<unknown>, timeoutMs: number) {
  let expire: NodeJS.Timeout | undefined
  const deadline = new Promise<void>((resolve) => {
    expire = setTimeout(resolve, timeoutMs)
  })
  try {
    await Promise.race([work, deadline])
  } finally {
    clearTimeout(expire)
  }
}
