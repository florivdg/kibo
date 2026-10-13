// The application server key pair from RFC 8291, section 5 and appendix A:
// public anyway, and a valid P-256 pair, so the tests can switch push on with
// it. No imports: tests/preload.ts reads it before the astro:env stub exists.
export const RFC8291_SERVER_KEYS = {
  publicKey:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  // The same pair as JWK: x and y are the two halves of the point
  privateJwk: {
    kty: 'EC',
    crv: 'P-256',
    x: '_jP0qw3qcZFNtVgj9ztUlI9BMG2SBzLbuaWaUyhkgiA',
    y: 'Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  },
}
