import { StorageSerializers, useLocalStorage } from '@vueuse/core'

// A record this browser keeps for itself in localStorage, read after
// mounting so server and client render the same markup, and kept in step
// with other tabs through the storage event. Nothing is written until there
// is something to keep — § 25 TDDDG covers any storage on the device, also
// an empty one: the record reads null until then, and setting it to null
// removes the entry again. `window` only for tests; the browser's otherwise.
export function useDeviceRecord<T extends object>(
  key: string,
  window?: Window,
) {
  return useLocalStorage<T | null>(key, null, {
    initOnMounted: true,
    listenToStorageChanges: true,
    // The default can't tell from null that the record is an object
    serializer: StorageSerializers.object,
    window,
  })
}
