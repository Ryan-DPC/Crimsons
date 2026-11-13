/**
 * Client billing Stripe (backend = Supabase Edge Functions).
 *
 * DÉSACTIVÉ par défaut : VITE_PAYMENTS_ENABLED !== 'true'.
 * Aucun CTA actif ne doit appeler ces helpers tant que le flag est false.
 *
 * Activation plus tard :
 * 1. Secrets Edge : PAYMENTS_ENABLED=true + clés Stripe test
 * 2. crimson/.env : VITE_PAYMENTS_ENABLED=true
 * 3. Brancher createCheckoutSession / createPortalSession dans SettingsTab
 *    (section Compte) — le refresh Premium existant suffit après webhook.
 */

import { supabase } from './supabase'

export const PAYMENTS_ENABLED =
  String(import.meta.env.VITE_PAYMENTS_ENABLED ?? 'false').toLowerCase() === 'true'

export type PremiumCheckoutPlan = 'premium_monthly' | 'premium_yearly'

export type CheckoutSessionResult = {
  id: string
  url: string | null
  mode: 'test' | 'live'
}

function assertPaymentsEnabled(): void {
  if (!PAYMENTS_ENABLED) {
    throw new Error(
      'Paiements désactivés (VITE_PAYMENTS_ENABLED=false). Voir docs/PAYMENTS.md.',
    )
  }
}

async function invokeJson<T>(name: string, body?: Record<string, unknown>): Promise<T> {
  assertPaymentsEnabled()
  const { data, error } = await supabase.functions.invoke(name, { body: body ?? {} })
  if (error) {
    throw new Error(error.message || `Edge Function ${name} a échoué`)
  }
  if (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) {
    throw new Error(String((data as { error: string }).error))
  }
  return data as T
}

/** Ouvre Checkout Stripe (mensuel / annuel). À brancher derrière un CTA plus tard. */
export async function createCheckoutSession(
  plan: PremiumCheckoutPlan,
): Promise<CheckoutSessionResult> {
  return invokeJson<CheckoutSessionResult>('create-checkout-session', { plan })
}

/** Portail client Stripe (facture / résiliation). */
export async function createPortalSession(): Promise<{ url: string }> {
  return invokeJson<{ url: string }>('create-portal-session')
}

/**
 * Stub UI : ne rend rien tant que les paiements sont off.
 * Quand on activera le flag, remplacer par de vrais boutons Checkout.
 */
export function paymentsUiEnabled(): boolean {
  return PAYMENTS_ENABLED
}
