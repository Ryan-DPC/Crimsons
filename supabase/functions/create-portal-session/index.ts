/**
 * Stripe Customer Portal (gérer / annuler l'abonnement).
 * Auth : JWT Supabase. Flag PAYMENTS_ENABLED requis.
 */
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { assertStripeModeAllowed, loadPaymentsConfig } from '../_shared/payments.ts'
import { createServiceClient, createStripe, requireUser } from '../_shared/stripe.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'POST only' }, 405)
  }

  try {
    const cfg = loadPaymentsConfig(Deno.env)
    if (!cfg.paymentsEnabled) {
      return jsonResponse(
        { error: 'Paiements désactivés', code: 'PAYMENTS_DISABLED' },
        503,
      )
    }
    assertStripeModeAllowed(cfg)

    const user = await requireUser(req)
    const admin = createServiceClient()
    const { data: row, error } = await admin
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', user.userId)
      .maybeSingle()
    if (error) throw error
    if (!row?.stripe_customer_id) {
      return jsonResponse({ error: 'Aucun client Stripe pour cet utilisateur' }, 404)
    }

    const stripe = createStripe(cfg.stripeSecretKey)
    const portal = await stripe.billingPortal.sessions.create({
      customer: row.stripe_customer_id as string,
      return_url: cfg.siteUrl,
    })

    return jsonResponse({ url: portal.url })
  } catch (err) {
    if (err instanceof Response) return err
    const message = err instanceof Error ? err.message : String(err)
    console.error('[create-portal-session]', message)
    return jsonResponse({ error: message }, 500)
  }
})
