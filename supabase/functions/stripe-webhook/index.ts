/**
 * Webhook Stripe → tables billing + profiles.is_premium.
 * verify_jwt = false (signature Stripe à la place).
 *
 * Events : checkout.session.completed, customer.subscription.*, invoice.paid
 */
import Stripe from 'https://esm.sh/stripe@14.25.0?target=denonext'
import { jsonResponse, textResponse } from '../_shared/cors.ts'
import { isPremiumGrantingStatus, loadPaymentsConfig } from '../_shared/payments.ts'
import {
  createServiceClient,
  createStripe,
  unixToIso,
} from '../_shared/stripe.ts'

const cryptoProvider = Stripe.createSubtleCryptoProvider()

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return textResponse('POST only', 405)
  }

  const cfg = loadPaymentsConfig(Deno.env)
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
  if (!cfg.stripeSecretKey || !webhookSecret) {
    return textResponse('Stripe webhook non configuré', 500)
  }

  // Mode live gate aussi pour le webhook (évite d'appliquer des events live par erreur).
  try {
    if (cfg.stripeSecretKey.startsWith('sk_live_') && !cfg.stripeLiveEnabled) {
      return textResponse('Live Stripe gated (STRIPE_LIVE_ENABLED)', 503)
    }
  } catch {
    /* ignore */
  }

  const signature = req.headers.get('Stripe-Signature')
  if (!signature) return textResponse('Stripe-Signature manquant', 400)

  const body = await req.text()
  const stripe = createStripe(cfg.stripeSecretKey)

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret,
      undefined,
      cryptoProvider,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[stripe-webhook] signature', message)
    return textResponse(`Webhook Error: ${message}`, 400)
  }

  const admin = createServiceClient()

  // Idempotence
  const { data: seen } = await admin
    .from('stripe_webhook_events')
    .select('event_id')
    .eq('event_id', event.id)
    .maybeSingle()
  if (seen) {
    return jsonResponse({ ok: true, duplicate: true })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        await handleCheckoutCompleted(admin, stripe, session, event.type)
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await upsertSubscription(admin, sub)
        break
      }
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice
        await handleInvoicePaid(admin, invoice, event.type)
        break
      }
      default:
        console.log(`[stripe-webhook] ignore ${event.type}`)
    }

    await admin.from('stripe_webhook_events').insert({
      event_id: event.id,
      event_type: event.type,
    })

    return jsonResponse({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[stripe-webhook] handler', message)
    // Do not echo internal DB/Stripe details to the webhook caller.
    return textResponse('Webhook handler error', 500)
  }
})

/** UUID v4-ish shape — refuse arbitrary metadata strings (IDOR hardening). */
function isUuid(value: string | null | undefined): value is string {
  if (!value) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value.trim())
}

/**
 * Resolve Supabase user for a Stripe object.
 * Prefer the durable customer→user mapping over session metadata so a forged
 * `supabase_user_id` / `client_reference_id` cannot reassign an existing customer.
 */
async function resolveUserId(
  admin: ReturnType<typeof createServiceClient>,
  opts: {
    metadataUserId?: string | null
    clientReferenceId?: string | null
    customerId?: string | null
  },
): Promise<string | null> {
  if (opts.customerId) {
    const { data } = await admin
      .from('stripe_customers')
      .select('user_id')
      .eq('stripe_customer_id', opts.customerId)
      .maybeSingle()
    const mapped = (data?.user_id as string | undefined) ?? null
    if (mapped) {
      const claimed = opts.metadataUserId ?? opts.clientReferenceId
      if (claimed && isUuid(claimed) && claimed !== mapped) {
        console.warn(
          `[stripe-webhook] ignoring metadata user_id mismatch for customer ${opts.customerId}`,
        )
      }
      return mapped
    }
  }

  const candidates = [opts.metadataUserId, opts.clientReferenceId]
  for (const c of candidates) {
    if (isUuid(c)) return c.trim()
  }
  return null
}

async function handleCheckoutCompleted(
  admin: ReturnType<typeof createServiceClient>,
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  eventType: string,
) {
  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id ?? null
  const userId = await resolveUserId(admin, {
    metadataUserId: session.metadata?.supabase_user_id ?? null,
    clientReferenceId: session.client_reference_id,
    customerId,
  })

  if (userId && customerId) {
    await admin.from('stripe_customers').upsert(
      {
        user_id: userId,
        stripe_customer_id: customerId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
  }

  const { error: payErr } = await admin.from('payments').insert({
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_checkout_session_id: session.id,
    amount_cents: session.amount_total,
    currency: session.currency,
    status: session.payment_status ?? 'paid',
    paid_at: new Date().toISOString(),
    raw_event_type: eventType,
  })
  // 23505 = duplicate (replay) — idempotence event_id couvre déjà le cas nominal.
  if (payErr && !String(payErr.message ?? '').includes('duplicate') && payErr.code !== '23505') {
    throw payErr
  }

  const subRef = session.subscription
  const subId = typeof subRef === 'string' ? subRef : subRef?.id
  if (subId) {
    const sub = await stripe.subscriptions.retrieve(subId)
    await upsertSubscription(admin, sub)
  } else if (userId) {
    await admin.rpc('sync_premium_from_subscriptions', { p_user_id: userId })
  }
}

async function upsertSubscription(
  admin: ReturnType<typeof createServiceClient>,
  sub: Stripe.Subscription,
) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
  const priceId = sub.items.data[0]?.price?.id ?? ''
  const userId = await resolveUserId(admin, {
    metadataUserId: sub.metadata?.supabase_user_id ?? null,
    customerId,
  })
  if (!userId) {
    console.warn(`[stripe-webhook] subscription ${sub.id} sans user_id`)
    return
  }

  await admin.from('stripe_customers').upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )

  await admin.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      stripe_price_id: priceId,
      status: sub.status,
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
      current_period_start: unixToIso(sub.current_period_start),
      current_period_end: unixToIso(sub.current_period_end),
      canceled_at: unixToIso(sub.canceled_at),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'stripe_subscription_id' },
  )

  await admin.rpc('sync_premium_from_subscriptions', { p_user_id: userId })

  if (isPremiumGrantingStatus(sub.status)) {
    console.log(`[stripe-webhook] premium granted user=${userId} status=${sub.status}`)
  }
}

async function handleInvoicePaid(
  admin: ReturnType<typeof createServiceClient>,
  invoice: Stripe.Invoice,
  eventType: string,
) {
  const customerId =
    typeof invoice.customer === 'string'
      ? invoice.customer
      : invoice.customer?.id ?? null
  const userId = await resolveUserId(admin, { customerId })

  await admin.from('payments').upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_invoice_id: invoice.id,
      stripe_payment_intent_id:
        typeof invoice.payment_intent === 'string'
          ? invoice.payment_intent
          : invoice.payment_intent?.id ?? null,
      amount_cents: invoice.amount_paid,
      currency: invoice.currency,
      status: invoice.status ?? 'paid',
      paid_at: unixToIso(invoice.status_transitions?.paid_at) ?? new Date().toISOString(),
      raw_event_type: eventType,
    },
    { onConflict: 'stripe_invoice_id' },
  )

  // Renouvellement : s'assurer que le Premium reste aligné.
  if (userId) {
    await admin.rpc('sync_premium_from_subscriptions', { p_user_id: userId })
  }
}
