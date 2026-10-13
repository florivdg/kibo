import { describe, expect, test } from 'bun:test'

import {
  clientAddressOf,
  clientIdentity,
  clientNetworks,
  normalizeIp,
  UNKNOWN_CLIENT,
} from '@/lib/spam/client-ip'

// The rules come from Better Auth, so the note budgets and the auth rate
// limits collapse addresses identically. These tests pin the behaviour Kibo
// depends on, including the parts Kibo adds on top: ports, zone ids and what
// happens to a header that can't be resolved.

describe('normalizeIp', () => {
  test('keeps an IPv4 address as it is', () => {
    expect(normalizeIp('203.0.113.7')).toBe('203.0.113.7')
  })

  test('maps equivalent spellings of one address onto one identity', () => {
    const expected = '2001:0db8:0000:0001:0000:0000:0000:0000'
    for (const spelling of [
      '2001:db8:0:1::1',
      '2001:DB8:0:1:0:0:0:1',
      '2001:0db8:0000:0001:0000:0000:0000:0001',
      '[2001:db8:0:1::1]',
      '2001:db8:0:1::1%eth0',
      ' 2001:db8:0:1::1 ',
      '[2001:db8:0:1::1]:8443',
    ]) {
      expect(normalizeIp(spelling)).toBe(expected)
    }
  })

  test('collapses every address inside the same /64', () => {
    const first = normalizeIp('2001:db8:abcd:1234::1')
    expect(normalizeIp('2001:db8:abcd:1234:ffff:ffff:ffff:ffff')).toBe(first!)
    // A different /64 is a different budget
    expect(normalizeIp('2001:db8:abcd:1235::1')).not.toBe(first!)
  })

  test('shares the IPv4 budget for IPv4-mapped IPv6', () => {
    expect(normalizeIp('::ffff:203.0.113.7')).toBe('203.0.113.7')
    expect(normalizeIp('::ffff:cb00:7107')).toBe('203.0.113.7')
  })

  test('ignores a port', () => {
    expect(normalizeIp('203.0.113.7:1234')).toBe('203.0.113.7')
    expect(normalizeIp('[::ffff:203.0.113.7]:443')).toBe('203.0.113.7')
  })

  test('rejects what is not an address', () => {
    for (const value of ['', 'nope', '1.2.3', '1.2.3.999', '2001:db8::1::2']) {
      expect(normalizeIp(value)).toBeUndefined()
    }
  })
})

describe('clientIdentity', () => {
  test('uses the single value the proxy sets', () => {
    expect(clientIdentity('203.0.113.7', '10.0.0.1')).toBe('203.0.113.7')
  })

  // Astro's clientAddress is the leftmost X-Forwarded-For value whenever the
  // header is there (getFirstForwardedValue in
  // node_modules/astro/dist/core/app/node.js) and the socket otherwise. Built
  // the same way here, so the test fails if that value is ever trusted.
  const astroClientAddress = (forwardedFor: string | null, socket: string) =>
    forwardedFor?.split(',').map((entry) => entry.trim())[0] || socket

  test('never trusts the address Astro takes from a forged chain', () => {
    for (const forged of ['6.6.6.6, 203.0.113.7', '6.6.6.6, keine-adresse']) {
      const astro = astroClientAddress(forged, '10.0.0.1')
      expect(astro).toBe('6.6.6.6')
      expect(clientIdentity(forged, astro)).toBe(UNKNOWN_CLIENT)
    }
  })

  // Choosing one's own budget by writing a new chain each time is the lever
  // this closes: all of them end up in one shared identity
  test('puts every chain it cannot resolve into one shared identity', () => {
    expect(clientIdentity('1.2.3.4, 203.0.113.7', '1.2.3.4')).toBe(
      UNKNOWN_CLIENT,
    )
    expect(clientIdentity('9.9.9.9, 8.8.8.8', '9.9.9.9')).toBe(UNKNOWN_CLIENT)
    expect(clientIdentity('keine-adresse', 'keine-adresse')).toBe(
      UNKNOWN_CLIENT,
    )
  })

  test('uses the connection only when there is no header at all', () => {
    expect(clientIdentity(null, '203.0.113.7')).toBe('203.0.113.7')
    // Astro reports the socket for an empty header, too
    expect(clientIdentity('', astroClientAddress('', '203.0.113.7'))).toBe(
      '203.0.113.7',
    )
    expect(clientIdentity(null, undefined)).toBe(UNKNOWN_CLIENT)
  })

  test('walks a configured chain from the right to the first untrusted hop', () => {
    const trusted = ['10.0.0.0/8', '192.0.2.1']
    // Client, CDN, our proxy: the CDN and the proxy are ours
    expect(
      clientIdentity('203.0.113.7, 192.0.2.1, 10.1.2.3', undefined, trusted),
    ).toBe('203.0.113.7')
    // Ports in the chain don't hide a hop
    expect(
      clientIdentity('203.0.113.7:9000, 10.1.2.3', undefined, trusted),
    ).toBe('203.0.113.7')
  })

  test('trusts nothing when the whole chain is a trusted range', () => {
    // Naming a broad private range that also covers clients yields no client
    // address at all rather than an invented one
    expect(
      clientIdentity('10.9.9.9, 10.1.2.3', '10.9.9.9', ['10.0.0.0/8']),
    ).toBe(UNKNOWN_CLIENT)
  })
})

// The wider IPv6 networks the budgets of posting and reporting count as well
describe('clientNetworks', () => {
  test('cuts an IPv6 address to its /64, /56 and /48', () => {
    expect(clientNetworks('2001:db8:abcd:12ff:1:2:3:4', undefined)).toEqual({
      client: '2001:0db8:abcd:12ff:0000:0000:0000:0000',
      client56: '2001:0db8:abcd:1200:0000:0000:0000:0000',
      client48: '2001:0db8:abcd:0000:0000:0000:0000:0000',
    })
  })

  test('maps equivalent spellings onto the same prefixes', () => {
    const expected = clientNetworks('2001:db8:0:1::1', undefined)
    for (const spelling of [
      '2001:DB8:0:1:0:0:0:1',
      '[2001:db8:0:1::1]:8443',
      '2001:db8:0:1::1%eth0',
    ]) {
      expect(clientNetworks(spelling, undefined)).toEqual(expected)
      expect(clientNetworks(null, spelling)).toEqual(expected)
    }
  })

  test('puts the /64s of one home line into one /56, and no further', () => {
    const line = clientNetworks('2001:db8:abcd:1200::1', undefined)
    const neighbour = clientNetworks('2001:db8:abcd:12ff::1', undefined)
    expect(neighbour.client).not.toBe(line.client)
    expect(neighbour.client56).toBe(line.client56!)
    const nextLine = clientNetworks('2001:db8:abcd:1300::1', undefined)
    expect(nextLine.client56).not.toBe(line.client56!)
    expect(nextLine.client48).toBe(line.client48!)
    expect(clientNetworks('2001:db8:abce::1', undefined).client48).not.toBe(
      line.client48!,
    )
  })

  test('gives IPv4 and the shared identity no wider network', () => {
    expect(clientNetworks('203.0.113.7', '10.0.0.1')).toEqual({
      client: '203.0.113.7',
    })
    expect(clientNetworks('::ffff:203.0.113.7', undefined)).toEqual({
      client: '203.0.113.7',
    })
    expect(clientNetworks('6.6.6.6, 203.0.113.7', '6.6.6.6')).toEqual({
      client: UNKNOWN_CLIENT,
    })
    expect(clientNetworks(null, undefined)).toEqual({ client: UNKNOWN_CLIENT })
  })

  test('says the same about the client as clientIdentity', () => {
    for (const address of ['203.0.113.7', '2001:db8::1', 'keine-adresse']) {
      expect(clientNetworks(address, undefined).client).toBe(
        clientIdentity(address, undefined),
      )
    }
  })
})

// What the page-view counting hands on to Plausible: the same rules, the
// whole address, and nothing at all where the budgets would share one
describe('clientAddressOf', () => {
  test('keeps an IPv6 address whole', () => {
    expect(clientAddressOf('2001:db8:abcd:1234::1', '10.0.0.1')).toBe(
      '2001:0db8:abcd:1234:0000:0000:0000:0001',
    )
    expect(clientAddressOf(null, '[2001:db8::7]:443')).toBe(
      '2001:0db8:0000:0000:0000:0000:0000:0007',
    )
    expect(clientAddressOf('203.0.113.7', '10.0.0.1')).toBe('203.0.113.7')
    expect(clientAddressOf('::ffff:203.0.113.7', undefined)).toBe('203.0.113.7')
  })

  test('walks a configured chain like the budgets', () => {
    expect(
      clientAddressOf('203.0.113.7, 10.1.2.3', undefined, ['10.0.0.0/8']),
    ).toBe('203.0.113.7')
  })

  test('tells nothing where the budgets fall back to the shared identity', () => {
    expect(clientAddressOf('6.6.6.6, 203.0.113.7', '6.6.6.6')).toBeUndefined()
    expect(clientAddressOf('keine-adresse', 'keine-adresse')).toBeUndefined()
    expect(clientAddressOf(null, undefined)).toBeUndefined()
    expect(clientAddressOf(null, 'keine-adresse')).toBeUndefined()
  })
})
