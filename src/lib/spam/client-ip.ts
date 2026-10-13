import {
  getIPFromHeader,
  isValidIP,
  normalizeIP,
} from '@better-auth/core/utils/ip'

// Turns the address of a request into the identity the budgets are counted
// for. The rules themselves come from Better Auth, so the note budgets and the
// auth rate limits provably collapse addresses the same way: IPv6 to a /64
// (the smallest prefix a client can't rotate inside for free), IPv4-mapped
// IPv6 onto the plain IPv4 address, and a forwarded chain walked from the
// right past every trusted proxy.
const IPV6_SUBNET = 64
// The wider prefixes an IPv6 client is counted for as well: a home line
// usually gets a /56, a cheap server a /48 — 256 and 65,536 /64s to rotate
// through for free
const IPV6_HOME_LINE = 56
const IPV6_SITE = 48
// No prefix cut off: the address as the client has it
const WHOLE_ADDRESS = 128

// The shared identity for requests whose origin can't be told. Behind the
// documented proxy setup this never happens; when it does, those requests
// share one budget rather than each picking a budget of its own.
export const UNKNOWN_CLIENT = 'unbekannt'

// Better Auth validates addresses strictly, so a port or a zone id would make
// one look invalid. Both say nothing about who is calling: "[2001:db8::1]:443"
// and "2001:db8::1%eth0" are the same client as "2001:db8::1".
function bareAddress(value: string) {
  const text = (value.trim().split('%')[0] ?? '').trim()
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(text)
  if (bracketed) return bracketed[1]!
  // A single colon next to dots can only be a port; several mean IPv6
  const colon = text.indexOf(':')
  if (colon !== -1 && colon === text.lastIndexOf(':') && text.includes('.')) {
    return text.slice(0, colon)
  }
  return text
}

// Equivalent spellings of the same address end up identical; undefined when
// the value is not an address at all
export function normalizeIp(value: string, ipv6Subnet = IPV6_SUBNET) {
  const address = bareAddress(value)
  return isValidIP(address) ? normalizeIP(address, { ipv6Subnet }) : undefined
}

let warned = false

// Once per process: an unreadable chain is a set-up problem (a proxy that
// appends without TRUSTED_PROXIES, or the app port reachable directly), and it
// quietly puts every such request into one budget
function warnUnresolved() {
  if (warned) return
  warned = true
  console.warn(
    '[spam] X-Forwarded-For ließ sich nicht auflösen; solche Anfragen teilen ' +
      'sich ein Budget. TRUSTED_PROXIES prüfen ' +
      '(docs/selbst-hosten/spam-schutz.md).',
  )
}

// The proxy in front of the app replaces whatever X-Forwarded-For a client
// sent with a value of its own. Without configured proxies Better Auth trusts
// a single-value header only — exactly what Traefik produces on its own; with
// them it walks the chain from the right to the first hop nobody vouched for.
//
// A header it can't resolve does not fall back to the address Astro hands
// over: with X-Forwarded-For present, that is the leftmost value of the chain
// (node_modules/astro/dist/core/app/node.js), which the client writes itself —
// every forged chain would pick its own budget. It ends in the shared
// UNKNOWN_CLIENT instead. The connection's address only counts when there is
// no header at all, which is when Astro reports the socket.
export function clientIdentity(
  forwardedFor: string | null,
  clientAddress: string | undefined,
  trustedProxies: string[] = [],
) {
  return clientNetworks(forwardedFor, clientAddress, trustedProxies).client
}

// What the budgets of the public actions are counted for, named like the
// budgets' subjects (src/lib/spam/budgets.ts): the client — an IPv4 address,
// an IPv6 /64 or UNKNOWN_CLIENT — and, for IPv6 only, its /56 and /48. IPv4
// has no wider network: behind carrier-grade NAT a /24 is whole
// neighbourhoods, and the shared UNKNOWN_CLIENT is already one budget.
export interface ClientNetworks {
  client: string
  client56?: string
  client48?: string
}

export function clientNetworks(
  forwardedFor: string | null,
  clientAddress: string | undefined,
  trustedProxies: string[] = [],
): ClientNetworks {
  const address = clientAddressOf(forwardedFor, clientAddress, trustedProxies)
  if (!address) {
    if (forwardedFor?.trim()) warnUnresolved()
    return { client: UNKNOWN_CLIENT }
  }
  // Already IPv4 for an IPv4-mapped IPv6 address
  if (!address.includes(':')) return { client: address }
  return {
    client: normalizeIp(address, IPV6_SUBNET)!,
    client56: normalizeIp(address, IPV6_HOME_LINE)!,
    client48: normalizeIp(address, IPV6_SITE)!,
  }
}

// The visitor's address by the rules above, but whole — an IPv6 address is
// not cut down to its /64 — and undefined where clientIdentity falls back to
// the shared UNKNOWN_CLIENT. What clientNetworks cuts down, and what the
// page-view counting hands on: it tells Plausible who is visiting
// (src/lib/analytics/).
export function clientAddressOf(
  forwardedFor: string | null,
  clientAddress: string | undefined,
  trustedProxies: string[] = [],
) {
  if (!forwardedFor?.trim()) {
    return clientAddress ? normalizeIp(clientAddress, WHOLE_ADDRESS) : undefined
  }
  const header = forwardedFor.split(',').map(bareAddress).join(',')
  return (
    getIPFromHeader(header, { ipv6Subnet: WHOLE_ADDRESS, trustedProxies }) ??
    undefined
  )
}
