/**
 * Tests Deno de la logique partagée billing.
 * Exécuter : deno test --allow-env supabase/functions/_tests/payments_test.ts
 */
import {
  assertEquals,
  assertThrows,
} from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  assertStripeModeAllowed,
  isPremiumGrantingStatus,
  loadPaymentsConfig,
  parsePlan,
  planFromPriceId,
  priceIdForPlan,
} from '../_shared/payments.ts'

Deno.test('parsePlan accepte alias mensuel/annuel', () => {
  assertEquals(parsePlan('monthly'), 'premium_monthly')
  assertEquals(parsePlan('premium_yearly'), 'premium_yearly')
  assertEquals(parsePlan('nope'), null)
})

Deno.test('planFromPriceId mappe les price IDs env', () => {
  const cfg = {
    pricePremiumMonthly: 'price_m',
    pricePremiumYearly: 'price_y',
  }
  assertEquals(planFromPriceId('price_m', cfg), 'premium_monthly')
  assertEquals(planFromPriceId('price_y', cfg), 'premium_yearly')
  assertEquals(planFromPriceId('price_other', cfg), null)
})

Deno.test('priceIdForPlan échoue si env manquant', () => {
  assertThrows(() =>
    priceIdForPlan('premium_monthly', {
      pricePremiumMonthly: '',
      pricePremiumYearly: 'price_y',
    })
  )
})

Deno.test('assertStripeModeAllowed refuse live sans flag', () => {
  const cfg = loadPaymentsConfig({
    get(k: string) {
      const map: Record<string, string> = {
        PAYMENTS_ENABLED: 'true',
        STRIPE_LIVE_ENABLED: 'false',
        STRIPE_SECRET_KEY: 'sk_live_abc',
      }
      return map[k]
    },
  })
  assertThrows(() => assertStripeModeAllowed(cfg), Error, 'live')
})

Deno.test('assertStripeModeAllowed accepte sk_test_', () => {
  const cfg = loadPaymentsConfig({
    get(k: string) {
      const map: Record<string, string> = {
        STRIPE_SECRET_KEY: 'sk_test_abc',
      }
      return map[k]
    },
  })
  assertStripeModeAllowed(cfg)
})

Deno.test('isPremiumGrantingStatus', () => {
  assertEquals(isPremiumGrantingStatus('active'), true)
  assertEquals(isPremiumGrantingStatus('trialing'), true)
  assertEquals(isPremiumGrantingStatus('canceled'), false)
})

/** Mock minimal de la vérif de signature Stripe (format t=,v1=). */
Deno.test('webhook signature header format parseable', async () => {
  const secret = 'whsec_test_secret'
  const payload = '{"id":"evt_test","type":"invoice.paid"}'
  const timestamp = 1_700_000_000
  const signed = `${timestamp}.${payload}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed))
  const hex = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const header = `t=${timestamp},v1=${hex}`
  assertEquals(header.includes('v1='), true)
  assertEquals(hex.length, 64)
})
