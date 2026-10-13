import { randomUUID } from 'node:crypto'

import type { ActionAPIContext } from 'astro:actions'
import { z } from 'astro/zod'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { eq } from 'drizzle-orm'

import { subscription } from '@/actions/subscription'
import { hostedSubscription, organization } from '@/db/schema'
import { addBerlinDays, addDays, berlinDayEnd } from '@/lib/board/time'
import { kitaOwnerSubscription } from '@/lib/hosted/access'
import { invoiceMails } from '@/lib/hosted/invoice'
import { subscriptionPageView } from '@/lib/hosted/subscription-page'
import { termsMails } from '@/lib/hosted/terms'
import { hostedContact, hostedPricing, instanceMode } from '@/lib/instance'
import type { Mail } from '@/lib/mail/mailer'

import { refusal } from './helpers/actions'
import {
  addTestMember,
  newOwnedKita,
  newTestKita,
  newTestUser,
  removeTestKitas,
  removeTestUsers,
  setTestSubscription,
  subscriptionOf,
} from './helpers/fixtures'
import { testDb } from './helpers/spam-db'

// subscription.requestInvoice (src/actions/subscription.ts), run the way
// Astro runs it on the server, and what the subscription page shows to whom
// (src/lib/hosted/subscription-page.ts). Against the local PostgreSQL: every
// test has accounts, Kitas and addresses of its own, so the budgets it
// spends are nobody else's (their counters are keyed hashes and run out on
// their own).
const kitas: string[] = []
const users: string[] = []

// The two mails of a request, instead of a mail server, and the one that
// confirms an agreement to the terms
let sent: Mail[] = []
let termsSent: Mail[] = []
const realSend = invoiceMails.send
const realTermsSend = termsMails.send

// TEST-NET-2, a network per request unless a test pins one
let requests = 0

function contextOf(
  user: { id: string; name: string; email: string } | undefined,
  address?: string,
) {
  requests += 1
  return {
    locals: { user },
    request: new Request(
      'http://localhost:4321/_actions/subscription.requestInvoice',
      {
        method: 'POST',
        headers: {
          'x-forwarded-for': address ?? `198.51.100.${requests % 250}`,
        },
      },
    ),
  } as unknown as ActionAPIContext
}

// Every address a mail's HTML links to. The footer every mail ends with
// (src/lib/mail/footer.ts) links the imprint and the privacy policy, here the
// instance's own pages (BETTER_AUTH_URL is http://localhost:4321 in the tests).
const FOOTER_LINKS = [
  'http://localhost:4321/impressum',
  'http://localhost:4321/datenschutz',
]

function linksIn(html: string) {
  return [...html.matchAll(/href="([^"]*)"/g)].map(([, href]) => href)
}

// An address nobody else sends an invoice to, and the terms agreed to in
// the version the form showed — the current one
function billingOf(values: Record<string, unknown> = {}) {
  return {
    billingName: 'Kita Sonnenschein e. V.',
    billingAddress: 'Musterweg 1\n12345 Musterstadt',
    billingEmail: `rechnung-${randomUUID()}@kita.example`,
    acceptTerms: true,
    termsVersion: hostedContact.termsVersion,
    ...values,
  }
}

// What the action takes; the tests also hand it what it must turn away
type Input = Parameters<typeof subscription.requestInvoice.orThrow>[0]

// async: input the schema turns away throws before there is a promise
async function request(
  user: { id: string; name: string; email: string } | undefined,
  input: Record<string, unknown>,
  address?: string,
) {
  return subscription.requestInvoice.orThrow.call(
    contextOf(user, address),
    input as Input,
  )
}

// Whether the action's schema turned the input away, before the handler ran
async function invalid(call: Promise<unknown>) {
  try {
    await call
    return false
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error
    return true
  }
}

// An owner with one Kita, named so the mails can be told apart
async function newOwner(name = `Kita Regenbogen ${randomUUID()}`) {
  const { organizationId, owner } = await newOwnedKita()
  kitas.push(organizationId)
  users.push(owner.id)
  await testDb
    .update(organization)
    .set({ name })
    .where(eq(organization.id, organizationId))
  return { ...owner, organizationId, kita: name }
}

function setOnRow(userId: string, values: Record<string, unknown>) {
  return testDb
    .update(hostedSubscription)
    .set(values)
    .where(eq(hostedSubscription.userId, userId))
}

beforeEach(() => {
  instanceMode.hosted = true
  sent = []
  invoiceMails.send = async (mail) => {
    sent.push(mail)
  }
  termsSent = []
  termsMails.send = async (mail) => {
    termsSent.push(mail)
  }
})

afterEach(() => {
  instanceMode.hosted = false
  invoiceMails.send = realSend
  termsMails.send = realTermsSend
  hostedContact.termsVersion = '2026-10'
  hostedContact.operatorEmail = 'betrieb@kibo.example'
  hostedPricing.priceEur = 49
})

afterAll(async () => {
  await removeTestKitas(...kitas)
  await removeTestUsers(...users)
})

describe('an owner asks for an invoice', () => {
  test('the request is stored with where the invoice goes', async () => {
    const owner = await newOwner()
    await setTestSubscription(owner.id, 'trial')
    const billing = billingOf({
      billingName: '  Kita Sonnenschein e. V.  ',
      billingEmail: `  Rechnung-${randomUUID()}@Kita.example `,
    })

    const before = Date.now()
    await request(owner, billing)
    const after = Date.now()

    const row = (await subscriptionOf(owner.id))!
    expect(row).toMatchObject({
      billingName: 'Kita Sonnenschein e. V.',
      billingAddress: 'Musterweg 1\n12345 Musterstadt',
      billingEmail: billing.billingEmail.trim(),
      // Nothing about the subscription itself has changed
      paidUntil: null,
      complimentary: false,
      reminderStage: 0,
    })
    const requestedAt = row.invoiceRequestedAt!.getTime()
    expect(requestedAt).toBeGreaterThanOrEqual(before)
    expect(requestedAt).toBeLessThanOrEqual(after)
  })

  test('the operator gets everything the invoice needs, the billing address a confirmation', async () => {
    const owner = await newOwner()
    const second = await newTestKita()
    kitas.push(second)
    await addTestMember(second, owner.id)
    // Paid up to the end of the year: the invoice is for the next one
    await setTestSubscription(owner.id, 'active')
    await setOnRow(owner.id, { paidUntil: berlinDayEnd('2099-12-31') })
    const billing = billingOf()

    await request(owner, billing)

    expect(sent.map((mail) => mail.to)).toEqual([
      'betrieb@kibo.example',
      billing.billingEmail,
    ])
    const [toOperator, confirmation] = sent
    expect(toOperator!.subject).toBe(`Rechnungsanfrage von ${owner.email}`)
    expect(toOperator!.text).toContain(`Konto: ${owner.email}`)
    expect(toOperator!.text).toContain(`Kitas:\n  ${owner.kita}\n  Test-Kita`)
    expect(toOperator!.text).toContain(
      'Rechnungsempfänger: Kita Sonnenschein e. V.',
    )
    expect(toOperator!.text).toContain(
      'Rechnungsanschrift:\n  Musterweg 1\n  12345 Musterstadt',
    )
    expect(toOperator!.text).toContain(
      `Rechnungs-E-Mail: ${billing.billingEmail}`,
    )
    expect(toOperator!.text).toContain(
      'Jahresbetrag: 49 € (49 € inkl. 3 Kitas)',
    )
    expect(toOperator!.text).toContain(
      'Zeitraum: 1. Januar 2100 bis 31. Dezember 2100',
    )
    expect(toOperator!.text).toContain(
      `Nach Zahlungseingang: node dist/admin.mjs set-paid --email ${owner.email} --until 2100-12-31`,
    )
    // Reporting is all this mail does: nothing to click but the imprint and
    // the privacy policy in the footer every mail has
    expect(linksIn(toOperator!.html)).toEqual(FOOTER_LINKS)

    expect(confirmation!.subject).toBe('Ihre Rechnungsanfrage für Kibo')
    expect(confirmation!.text).toContain('Jahresbetrag: 49 €')
    expect(confirmation!.text).toContain(
      'Zeitraum: 1. Januar 2100 bis 31. Dezember 2100',
    )
    expect(confirmation!.text).toContain(
      'Es verlängert sich nicht automatisch.',
    )
    // It goes to an address the account typed: nothing about the account
    for (const part of [confirmation!.text, confirmation!.html]) {
      expect(part).not.toContain(owner.email)
      expect(part).not.toContain(owner.kita)
      expect(part).not.toContain('set-paid')
    }
    expect(linksIn(confirmation!.html)).toEqual(FOOTER_LINKS)
  })

  // What a municipal Kita's administration needs on the invoice
  test('a Leitweg-ID or order number goes with the request, into both mails', async () => {
    const owner = await newOwner()
    await setTestSubscription(owner.id, 'trial')
    await request(owner, billingOf({ billingReference: '  991-01234-44 ' }))
    expect((await subscriptionOf(owner.id))?.billingReference).toBe(
      '991-01234-44',
    )
    expect(sent).toHaveLength(2)
    for (const mail of sent) {
      expect(mail.text).toContain('Leitweg-ID / Bestellnummer: 991-01234-44')
    }
  })

  test('without one the mails have no such line', async () => {
    for (const billingReference of [undefined, '', '   ']) {
      const owner = await newOwner()
      await setTestSubscription(owner.id, 'trial')
      sent = []
      await request(owner, billingOf({ billingReference }))
      expect((await subscriptionOf(owner.id))?.billingReference).toBeNull()
      expect(sent).toHaveLength(2)
      for (const mail of sent) expect(mail.text).not.toContain('Leitweg-ID')
    }
  })

  test('a second request without one clears it', async () => {
    const owner = await newOwner()
    await setTestSubscription(owner.id, 'trial')
    await request(owner, billingOf({ billingReference: 'B-2026-17' }))
    await request(owner, billingOf())
    expect((await subscriptionOf(owner.id))?.billingReference).toBeNull()
  })

  test('the amount follows the Kitas the account owns and the configured price', async () => {
    hostedPricing.priceEur = 60
    const owner = await newOwner()
    for (let i = 0; i < 4; i++) {
      const id = await newTestKita()
      kitas.push(id)
      await addTestMember(id, owner.id)
    }
    await setTestSubscription(owner.id, 'grace')
    await request(owner, billingOf())
    for (const mail of sent) {
      expect(mail.text).toContain(
        'Jahresbetrag: 80 € (60 € inkl. 3 Kitas + 2 × 10 €)',
      )
    }
  })

  // What the account typed is text, in both parts of both mails
  test('nothing typed into the form becomes markup', async () => {
    const owner = await newOwner('Kita <i>Bunt</i> & "Froh"')
    await setTestSubscription(owner.id, 'trial')
    await request(
      owner,
      billingOf({
        billingName: 'Träger <b>gGmbH</b> & "Co"',
        billingAddress: 'Weg 1 <script>alert(1)</script>\nOrt & Land',
      }),
    )
    expect(sent).toHaveLength(2)
    for (const mail of sent) {
      expect(mail.html).toContain(
        'Träger &lt;b&gt;gGmbH&lt;/b&gt; &amp; &quot;Co&quot;',
      )
      expect(mail.html).toContain(
        'Weg 1 &lt;script&gt;alert(1)&lt;/script&gt;<br />Ort &amp; Land',
      )
      expect(mail.html).not.toContain('<b>')
      expect(mail.html).not.toContain('<script')
      expect(mail.text).toContain('Träger <b>gGmbH</b> & "Co"')
    }
    expect(sent[0]!.html).toContain(
      'Kita &lt;i&gt;Bunt&lt;/i&gt; &amp; &quot;Froh&quot;',
    )
    expect(sent[0]!.html).not.toContain('<i>')
  })

  // Asking again while a request is open is how an address is corrected
  test('a second request replaces what the first one said', async () => {
    const owner = await newOwner()
    await setTestSubscription(owner.id, 'paused')
    await request(owner, billingOf({ billingName: 'Alter Name' }))
    const first = (await subscriptionOf(owner.id))!.invoiceRequestedAt!

    const corrected = billingOf({ billingName: 'Neuer Name' })
    await request(owner, corrected)
    const row = (await subscriptionOf(owner.id))!
    expect(row).toMatchObject({
      billingName: 'Neuer Name',
      billingEmail: corrected.billingEmail,
    })
    expect(row.invoiceRequestedAt!.getTime()).toBeGreaterThanOrEqual(
      first.getTime(),
    )
    expect(sent).toHaveLength(4)
  })

  // The Kitas are gone, the account and its row are not: paying is how it
  // gets a Kita again
  test('an account whose Kitas were deleted can still ask', async () => {
    const account = await newTestUser()
    users.push(account.id)
    await setTestSubscription(account.id, 'deletable')
    await setOnRow(account.id, { kitasDeletedAt: new Date() })

    await request(account, billingOf())
    expect(
      (await subscriptionOf(account.id))?.invoiceRequestedAt,
    ).not.toBeNull()
    expect(sent[0]!.text).toContain('Kitas: keine')
  })

  // An owner the hourly run has not reached yet
  test('an owner without a row gets one, with the trial it would have started', async () => {
    const owner = await newOwner()
    const before = Date.now()
    await request(owner, billingOf())
    const row = (await subscriptionOf(owner.id))!
    expect(row.trialEndsAt.getTime()).toBeGreaterThanOrEqual(
      addBerlinDays(new Date(before), 30).getTime(),
    )
    expect(row).toMatchObject({ paidUntil: null, termsVersion: '2026-10' })
  })
})

describe('who may ask', () => {
  test('without a session: 401', async () => {
    expect(await refusal(request(undefined, billingOf()))).toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    })
    expect(sent).toEqual([])
  })

  // Invited to a Kita, owning none: the subscription is the owner's
  test('an invited admin: 403, and nothing is stored or sent', async () => {
    const owner = await newOwner()
    await setTestSubscription(owner.id, 'grace')
    const admin = await newTestUser()
    users.push(admin.id)
    await addTestMember(owner.organizationId, admin.id, 'admin')

    expect(await refusal(request(admin, billingOf()))).toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    })
    expect(await subscriptionOf(admin.id)).toBeUndefined()
    expect((await subscriptionOf(owner.id))?.invoiceRequestedAt).toBeNull()
    expect(sent).toEqual([])
  })

  test('an account without a Kita and without a subscription: 403', async () => {
    const account = await newTestUser()
    users.push(account.id)
    expect(await refusal(request(account, billingOf()))).toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(await subscriptionOf(account.id)).toBeUndefined()
  })

  test('an account that is free for good has nothing to ask for', async () => {
    const owner = await newOwner()
    await setTestSubscription(owner.id, 'paused')
    await setOnRow(owner.id, { complimentary: true })
    expect(await refusal(request(owner, billingOf()))).toEqual({
      code: 'BAD_REQUEST',
      status: 400,
      message:
        'Dieses Konto ist dauerhaft freigeschaltet und braucht keine Rechnung.',
    })
    expect(sent).toEqual([])
  })

  test('without HOSTED the action is not there: 404', async () => {
    const owner = await newOwner()
    await setTestSubscription(owner.id, 'grace')
    instanceMode.hosted = false
    expect(await refusal(request(owner, billingOf()))).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    })
    expect((await subscriptionOf(owner.id))?.invoiceRequestedAt).toBeNull()
    expect(sent).toEqual([])
  })
})

describe('what the form may say', () => {
  let owner: Awaited<ReturnType<typeof newOwner>>

  beforeEach(async () => {
    owner = await newOwner()
    await setTestSubscription(owner.id, 'trial')
  })

  async function untouched() {
    expect(sent).toEqual([])
    expect(await subscriptionOf(owner.id)).toMatchObject({
      billingName: null,
      billingAddress: null,
      billingEmail: null,
      invoiceRequestedAt: null,
    })
  }

  // All three end up in a mail to the operator and in one to a typed address
  test('no link in the recipient, the address or the reference', async () => {
    for (const values of [
      { billingName: 'Kita https://boese.example' },
      { billingName: 'www.boese.example' },
      { billingAddress: 'Musterweg 1\nhttp://boese.example/rechnung' },
      { billingAddress: 'siehe ftp://boese.example' },
      { billingReference: 'https://boese.example' },
    ]) {
      expect(await refusal(request(owner, billingOf(values)))).toEqual({
        code: 'BAD_REQUEST',
        status: 400,
        message:
          'Rechnungsempfänger, Anschrift und Leitweg-ID / Bestellnummer dürfen keinen Link enthalten.',
      })
    }
    await untouched()
  })

  test('no field left empty, too long or with control characters', async () => {
    for (const values of [
      { billingName: '' },
      { billingName: '   ' },
      { billingName: '​' },
      { billingName: 'x'.repeat(121) },
      // One line: a line break would end the subject of a mail
      { billingName: 'Kita\nBcc: alle@boese.example' },
      { billingName: 'Kita‮gnirts' },
      { billingAddress: '' },
      { billingAddress: 'x'.repeat(401) },
      { billingAddress: 'Musterweg\u00001' },
      { billingReference: 'x'.repeat(101) },
      { billingReference: '991-01234\n44' },
      { billingReference: 991 },
      { billingName: undefined },
      { acceptTerms: 'ja' },
      { termsVersion: 2026 },
      { termsVersion: 'x'.repeat(65) },
    ]) {
      expect(await invalid(request(owner, billingOf(values)))).toBe(true)
    }
    await untouched()
  })

  test('an address the invoice can go to', async () => {
    for (const billingEmail of [
      '',
      'buchhaltung',
      'buchhaltung@',
      'a@b.de, c@d.de',
      'a@b.de\nBcc: c@d.de',
      `${'x'.repeat(250)}@b.de`,
    ]) {
      expect(await invalid(request(owner, billingOf({ billingEmail })))).toBe(
        true,
      )
    }
    await untouched()
  })

  test('an address of several lines stays as it was typed', async () => {
    await request(
      owner,
      billingOf({
        billingAddress: '  z. Hd. Frau Beispiel\nMusterweg 1\n\n12345 Ort ',
      }),
    )
    expect((await subscriptionOf(owner.id))?.billingAddress).toBe(
      'z. Hd. Frau Beispiel\nMusterweg 1\n\n12345 Ort',
    )
  })
})

describe('the terms', () => {
  const REQUIRED = {
    code: 'BAD_REQUEST',
    status: 400,
    message:
      'Bitte stimmen Sie den AGB und dem Vertrag zur Auftragsverarbeitung zu.',
  }

  // A Kita older than HOSTED: the row came from the hourly run
  test('an owner who never agreed does so with the request', async () => {
    const owner = await newOwner()
    await setTestSubscription(owner.id, 'trial')

    for (const acceptTerms of [false, undefined]) {
      expect(await refusal(request(owner, billingOf({ acceptTerms })))).toEqual(
        REQUIRED,
      )
    }
    expect(await subscriptionOf(owner.id)).toMatchObject({
      termsVersion: null,
      termsAcceptedAt: null,
      invoiceRequestedAt: null,
    })
    expect(sent).toEqual([])
    expect(termsSent).toEqual([])

    const before = Date.now()
    await request(owner, billingOf())
    const row = (await subscriptionOf(owner.id))!
    expect(row.termsVersion).toBe('2026-10')
    expect(row.termsAcceptedAt!.getTime()).toBeGreaterThanOrEqual(before)
    expect(row.invoiceRequestedAt).toEqual(row.termsAcceptedAt)

    // The agreement is confirmed to the account, naming who the invoice goes
    // to and linking the exact version of both texts
    expect(termsSent).toHaveLength(1)
    const [mail] = termsSent
    expect(mail!.to).toBe(owner.email)
    expect(mail!.subject).toBe(
      'Ihre Zustimmung zu den AGB und zum AV-Vertrag von Kibo',
    )
    expect(mail!.text).toContain(`Konto: Test (${owner.email})`)
    expect(mail!.text).toContain(
      'Rechnung an:\n  Kita Sonnenschein e. V.\n  Musterweg 1\n  12345 Musterstadt',
    )
    expect(mail!.text).toContain('Fassung: 2026-10')
    expect(linksIn(mail!.html)).toEqual([
      'http://localhost:4321/agb/2026-10',
      'http://localhost:4321/avv/2026-10',
      ...FOOTER_LINKS,
    ])
  })

  test('new terms are agreed to with the next request', async () => {
    const owner = await newOwner()
    await setTestSubscription(owner.id, 'active')
    const agreedAt = new Date('2026-01-10T10:00:00.000Z')
    await setOnRow(owner.id, {
      termsVersion: '2026-01',
      termsAcceptedAt: agreedAt,
    })

    expect(
      await refusal(request(owner, billingOf({ acceptTerms: false }))),
    ).toEqual(REQUIRED)
    expect(await subscriptionOf(owner.id)).toMatchObject({
      termsVersion: '2026-01',
      termsAcceptedAt: agreedAt,
    })

    await request(owner, billingOf())
    const row = (await subscriptionOf(owner.id))!
    expect(row.termsVersion).toBe('2026-10')
    expect(row.termsAcceptedAt!.getTime()).toBeGreaterThan(agreedAt.getTime())
    expect(termsSent.map((mail) => mail.to)).toEqual([owner.email])
  })

  // A form left open while the terms changed: the box was ticked for texts
  // that are no longer the current ones
  test('an agreement to another version is turned away', async () => {
    const owner = await newOwner()
    await setTestSubscription(owner.id, 'trial')

    // The last one: a page rendered while the terms were agreed to showed no
    // box, so it sends neither the agreement nor a version
    for (const input of [
      { termsVersion: '2026-01' },
      { termsVersion: undefined },
      { termsVersion: '' },
      { acceptTerms: false, termsVersion: undefined },
    ]) {
      expect(await refusal(request(owner, billingOf(input)))).toEqual({
        code: 'BAD_REQUEST',
        status: 400,
        message:
          'AGB oder AV-Vertrag haben sich inzwischen geändert. Bitte laden Sie die Seite neu und stimmen Sie der aktuellen Fassung zu.',
      })
    }
    expect(await subscriptionOf(owner.id)).toMatchObject({
      termsVersion: null,
      termsAcceptedAt: null,
      billingName: null,
      invoiceRequestedAt: null,
    })
    expect(sent).toEqual([])
    expect(termsSent).toEqual([])

    // Turned away before a budget was counted: the next two go through
    await request(owner, billingOf())
    await request(owner, billingOf())
    expect((await subscriptionOf(owner.id))?.termsVersion).toBe('2026-10')
  })

  test('terms that are agreed to are not asked for again', async () => {
    const owner = await newOwner()
    await setTestSubscription(owner.id, 'grace')
    const agreedAt = new Date('2026-04-04T09:00:00.000Z')
    await setOnRow(owner.id, {
      termsVersion: '2026-10',
      termsAcceptedAt: agreedAt,
    })

    await request(owner, billingOf({ acceptTerms: false }))
    expect(await subscriptionOf(owner.id)).toMatchObject({
      termsVersion: '2026-10',
      // When it was agreed to, not when the invoice was asked for
      termsAcceptedAt: agreedAt,
    })
    expect(sent).toHaveLength(2)
    expect(termsSent).toEqual([])
  })
})

describe('the budgets', () => {
  // The windows run by the clock: the wait is what is left of the hour
  const WAIT =
    /^Bitte versuchen Sie es in (einer Minute|\d+ Minuten|einer Stunde) noch einmal\.$/

  test('the third request of an account within the hour has to wait', async () => {
    const owner = await newOwner()
    await setTestSubscription(owner.id, 'grace')
    await request(owner, billingOf({ billingName: 'Erste' }))
    await request(owner, billingOf({ billingName: 'Zweite' }))

    const third = await refusal(
      request(owner, billingOf({ billingName: 'Dritte' })),
    )
    expect(third).toMatchObject({ code: 'TOO_MANY_REQUESTS', status: 429 })
    expect(third?.message).toMatch(WAIT)
    // Refused before anything was stored or sent
    expect((await subscriptionOf(owner.id))?.billingName).toBe('Zweite')
    expect(sent).toHaveLength(4)
  })

  // The confirmation goes to an address the account typed: one network can't
  // have it written to over and over, whichever account asks
  test('an address takes three confirmations an hour from one network', async () => {
    const billingEmail = `rechnung-${randomUUID()}@kita.example`
    const network = '198.51.100.251'
    for (let i = 0; i < 3; i++) {
      const owner = await newOwner()
      await request(owner, billingOf({ billingEmail }), network)
    }
    const fourth = await newOwner()
    const refused = await refusal(
      request(fourth, billingOf({ billingEmail }), network),
    )
    expect(refused).toMatchObject({ code: 'TOO_MANY_REQUESTS', status: 429 })
    expect(refused?.message).toMatch(WAIT)
    expect(await subscriptionOf(fourth.id)).toBeUndefined()
    expect(sent.filter((mail) => mail.to === billingEmail)).toHaveLength(3)
  })

  test('a request that was turned away for its content costs nothing', async () => {
    const owner = await newOwner()
    await setTestSubscription(owner.id, 'grace')
    for (let i = 0; i < 4; i++) {
      await refusal(request(owner, billingOf({ billingName: 'www.x.example' })))
      await refusal(request(owner, billingOf({ acceptTerms: false })))
    }
    await request(owner, billingOf())
    await request(owner, billingOf())
    expect(sent).toHaveLength(4)
  })
})

// What /admin/abo renders from
describe('the subscription page', () => {
  const now = new Date()

  // The page as the middleware hands it the owner of the active Kita
  async function pageView(userId: string, organizationId: string | undefined) {
    const kitaOwner = organizationId
      ? await kitaOwnerSubscription(organizationId)
      : undefined
    return subscriptionPageView(userId, kitaOwner, now)
  }

  test('shows the owner the subscription, the price and the invoice', async () => {
    const owner = await newOwner()
    await setTestSubscription(owner.id, 'grace', now)
    const billing = billingOf()
    await request(owner, billing)

    const view = await pageView(owner.id, owner.organizationId)
    expect(view).toMatchObject({
      role: 'owner',
      summary: { state: 'grace' },
      kitas: [owner.kita],
      price: { baseEur: 49, includedKitas: 3, extraKitas: 0, totalEur: 49 },
      billed: true,
      billing: {
        billingName: billing.billingName,
        billingAddress: billing.billingAddress,
        billingEmail: billing.billingEmail,
      },
      // Agreed with the request
      termsRequired: false,
    })
    expect(view.role === 'owner' && view.invoiceRequest).toEqual({
      on: expect.any(String),
      email: billing.billingEmail,
    })
    expect(view.role === 'owner' && view.period).toMatch(/ bis /)
  })

  test('asks an owner who has not agreed to the current terms', async () => {
    const owner = await newOwner()
    await setTestSubscription(owner.id, 'trial', now)
    expect(await pageView(owner.id, owner.organizationId)).toMatchObject({
      role: 'owner',
      termsRequired: true,
      invoiceRequest: undefined,
      billing: { billingName: '', billingAddress: '', billingEmail: '' },
    })
    await setOnRow(owner.id, { termsVersion: '2026-10' })
    hostedContact.termsVersion = '2027-01'
    expect(await pageView(owner.id, owner.organizationId)).toMatchObject({
      termsRequired: true,
    })
    hostedContact.termsVersion = '2026-10'
    expect(await pageView(owner.id, owner.organizationId)).toMatchObject({
      termsRequired: false,
    })
  })

  test('shows an invited admin the state, and nothing about the invoice', async () => {
    const owner = await newOwner()
    await setTestSubscription(owner.id, 'paused', now)
    await request(owner, billingOf())
    const admin = await newTestUser()
    users.push(admin.id)
    await addTestMember(owner.organizationId, admin.id, 'admin')

    const view = await pageView(admin.id, owner.organizationId)
    expect(view).toEqual({
      role: 'admin',
      summary: {
        state: 'paused',
        title: expect.stringMatching(/^Pausiert seit /),
        detail: expect.any(String),
      },
    })
    expect(JSON.stringify(view)).not.toContain('kita.example')
  })

  test('an owner sees their own subscription, whichever Kita is active', async () => {
    const host = await newOwner()
    await setTestSubscription(host.id, 'paused', now)
    const owner = await newOwner()
    await setTestSubscription(owner.id, 'active', now)
    await addTestMember(host.organizationId, owner.id, 'admin')

    expect(await pageView(owner.id, host.organizationId)).toMatchObject({
      role: 'owner',
      summary: { state: 'active' },
    })
  })

  // Reachable without a Kita: the Kitas are gone, the subscription is not
  test('an account whose Kitas were deleted still sees its subscription', async () => {
    const account = await newTestUser()
    users.push(account.id)
    await setTestSubscription(account.id, 'deletable', now)
    await setOnRow(account.id, { kitasDeletedAt: addDays(now, -1) })
    expect(await pageView(account.id, undefined)).toMatchObject({
      role: 'owner',
      summary: { state: 'deleted' },
      kitas: [],
      billed: true,
    })
  })

  test('an account that is free for good is not billed', async () => {
    const owner = await newOwner()
    await setTestSubscription(owner.id, 'paused', now)
    await setOnRow(owner.id, { complimentary: true })
    expect(await pageView(owner.id, owner.organizationId)).toMatchObject({
      role: 'owner',
      summary: { state: 'free' },
      billed: false,
    })
  })

  test('an account without a Kita has no subscription to show', async () => {
    const account = await newTestUser()
    users.push(account.id)
    expect(await pageView(account.id, undefined)).toEqual({
      role: 'none',
    })
  })
})
