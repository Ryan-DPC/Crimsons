import Stripe from 'https://esm.sh/stripe@14.25.0?target=denonext'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

export { Stripe }

export function createStripe(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  })
}

export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function requireUser(
  req: Request,
): Promise<{ userId: string; email: string | null; accessToken: string }> {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    throw new Response(JSON.stringify({ error: 'Authorization Bearer requis' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const accessToken = auth.slice('Bearer '.length).trim()
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anon) {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY manquants')
  }
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await userClient.auth.getUser()
  if (error || !data.user) {
    throw new Response(JSON.stringify({ error: 'Session invalide' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    accessToken,
  }
}

export async function getOrCreateStripeCustomer(
  admin: SupabaseClient,
  stripe: Stripe,
  userId: string,
  email: string | null,
): Promise<string> {
  const { data: existing, error: readErr } = await admin
    .from('stripe_customers')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (readErr) throw readErr
  if (existing?.stripe_customer_id) return existing.stripe_customer_id as string

  const customer = await stripe.customers.create({
    email: email ?? undefined,
    metadata: { supabase_user_id: userId },
  })

  const { error: upsertErr } = await admin.from('stripe_customers').upsert(
    {
      user_id: userId,
      stripe_customer_id: customer.id,
      email,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (upsertErr) throw upsertErr
  return customer.id
}

export function unixToIso(secs: number | null | undefined): string | null {
  if (secs == null) return null
  return new Date(secs * 1000).toISOString()
}
