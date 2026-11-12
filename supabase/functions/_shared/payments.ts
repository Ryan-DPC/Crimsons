/** Logique partagée billing (testable hors Deno serve). */

export type PremiumPlan = 'premium_monthly' | 'premium_yearly'

export type PaymentsConfig = {
  paymentsEnabled: boolean
  stripeLiveEnabled: boolean
  stripeSecretKey: string
  pricePremiumMonthly: string
  pricePremiumYearly: string
  siteUrl: string
  successPath: string
  cancelPath: string
}

export function parseBool(value: string | undefined | null, fallback = false): boolean {
  if (value == null || value === '') return fallback
  const v = value.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

export function loadPaymentsConfig(env: {
  get(key: string): string | undefined
}): PaymentsConfig {
  return {
    paymentsEnabled: parseBool(env.get('PAYMENTS_ENABLED'), false),
    stripeLiveEnabled: parseBool(env.get('STRIPE_LIVE_ENABLED'), false),
    stripeSecretKey: env.get('STRIPE_SECRET_KEY') ?? '',
    pricePremiumMonthly: env.get('STRIPE_PRICE_PREMIUM_MONTHLY') ?? '',
    pricePremiumYearly: env.get('STRIPE_PRICE_PREMIUM_YEARLY') ?? '',
    siteUrl: (env.get('SITE_URL') ?? 'http://127.0.0.1:5173').replace(/\/$/, ''),
    successPath: env.get('CHECKOUT_SUCCESS_PATH') ?? '/?checkout=success',
    cancelPath: env.get('CHECKOUT_CANCEL_PATH') ?? '/?checkout=cancel',
  }
}

/** Refuse les clés live tant que STRIPE_LIVE_ENABLED n'est pas true. */
export function assertStripeModeAllowed(cfg: PaymentsConfig): void {
  if (!cfg.stripeSecretKey) {
    throw new Error('STRIPE_SECRET_KEY manquant')
  }
  const isLiveKey = cfg.stripeSecretKey.startsWith('sk_live_')
  const isTestKey = cfg.stripeSecretKey.startsWith('sk_test_')
  if (isLiveKey && !cfg.stripeLiveEnabled) {
    throw new Error(
      'Clé Stripe live refusée : définir STRIPE_LIVE_ENABLED=true après validation CH (KYC, IBAN, CGV/TVA).',
    )
  }
  if (!isLiveKey && !isTestKey) {
    throw new Error('STRIPE_SECRET_KEY invalide (attendu sk_test_… ou sk_live_…)')
  }
}

export function priceIdForPlan(
  plan: PremiumPlan,
  cfg: Pick<PaymentsConfig, 'pricePremiumMonthly' | 'pricePremiumYearly'>,
): string {
  const id = plan === 'premium_yearly' ? cfg.pricePremiumYearly : cfg.pricePremiumMonthly
  if (!id) {
    throw new Error(`Price ID manquant pour ${plan}`)
  }
  return id
}

export function planFromPriceId(
  priceId: string,
  cfg: Pick<PaymentsConfig, 'pricePremiumMonthly' | 'pricePremiumYearly'>,
): PremiumPlan | null {
  if (!priceId) return null
  if (priceId === cfg.pricePremiumMonthly) return 'premium_monthly'
  if (priceId === cfg.pricePremiumYearly) return 'premium_yearly'
  return null
}

export function isPremiumGrantingStatus(status: string | null | undefined): boolean {
  return status === 'active' || status === 'trialing'
}

export function parsePlan(raw: unknown): PremiumPlan | null {
  if (raw === 'premium_monthly' || raw === 'monthly' || raw === 'month') {
    return 'premium_monthly'
  }
  if (raw === 'premium_yearly' || raw === 'yearly' || raw === 'year' || raw === 'annual') {
    return 'premium_yearly'
  }
  return null
}

/** Statuts d'abonnement qui doivent retirer le Premium (sauf allowlist). */
export function isPremiumRevokingStatus(status: string | null | undefined): boolean {
  if (!status) return false
  return (
    status === 'canceled' ||
    status === 'unpaid' ||
    status === 'incomplete_expired' ||
    status === 'paused'
  )
}
