// Addresses are compared the way people read them, and the way Better Auth
// stores them: without the spaces around them and in lower case. No imports,
// so the rules that are tried without a database can use it too.
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}
