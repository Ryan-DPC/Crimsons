/**
 * Crée une Stripe Checkout Session (abonnement Premium).
 * Auth : JWT Supabase (Bearer).
 * Feature flag : PAYMENTS_ENABLED=true requis.
 */
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import {
  assertStripeModeAllowed,
  loadPaymentsConfig,
  parsePlan,
  priceIdForPlan,
} from '../_shared/payments.ts'
import {
  createServiceClient,
  createStripe,
  getOrCreateStripeCustomer,
  requireUser,
} from '../_shared/stripe.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'POST only' }, 405, req)
  }

  try {
    const cfg = loadPaymentsConfig(Deno.env)
    if (!cfg.paymentsEnabled) {
      return jsonResponse(
        {
          error: 'Paiements désactivés',
          code: 'PAYMENTS_DISABLED',
          hint: 'Définir PAYMENTS_ENABLED=true (secrets Edge + VITE_PAYMENTS_ENABLED côté UI).',
        },
        503,
        req,
      )
    }
    assertStripeModeAllowed(cfg)

    const user = await requireUser(req)
    const body = await req.json().catch(() => ({}))
    const plan = parsePlan(body?.plan)
    if (!plan) {
      return jsonResponse(
        { error: 'plan invalide (premium_monthly | premium_yearly)' },
        400,
        req,
      )
    }

    const priceId = priceIdForPlan(plan, cfg)
    const stripe = createStripe(cfg.stripeSecretKey)
    const admin = createServiceClient()
    const customerId = await getOrCreateStripeCustomer(
      admin,
      stripe,
      user.userId,
      user.email,
    )

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${cfg.siteUrl}${cfg.successPath}`,
      cancel_url: `${cfg.siteUrl}${cfg.cancelPath}`,
      client_reference_id: user.userId,
      metadata: {
        supabase_user_id: user.userId,
        plan,
      },
      subscription_data: {
        metadata: {
          supabase_user_id: user.userId,
          plan,
        },
      },
      allow_promotion_codes: true,
    })

    return jsonResponse(
      {
        id: session.id,
        url: session.url,
        mode: cfg.stripeSecretKey.startsWith('sk_live_') ? 'live' : 'test',
      },
      200,
      req,
    )
  } catch (err) {
    if (err instanceof Response) return err
    const message = err instanceof Error ? err.message : String(err)
    console.error('[create-checkout-session]', message)
    return jsonResponse({ error: 'checkout_failed' }, 500, req)
  }
})
