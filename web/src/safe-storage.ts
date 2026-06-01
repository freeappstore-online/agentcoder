/** Safe localStorage wrappers — no-op in private/incognito or restricted contexts */

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Quota exceeded or access denied (Safari private mode)
  }
}

export function storageRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Access denied
  }
}
