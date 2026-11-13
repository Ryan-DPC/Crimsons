/** CORS for Edge Functions. Authenticated billing endpoints should not mirror `*`. */

function siteOrigin(): string | null {
  const raw = Deno.env.get('SITE_URL')?.trim()
  if (!raw) return null
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

export function corsHeaders(req?: Request): Record<string, string> {
  const allowed = siteOrigin()
  const requestOrigin = req?.headers.get('Origin')?.trim() ?? ''
  let allowOrigin = 'null'
  if (allowed) {
    // Exact match only — desktop Vite / production site.
    if (!requestOrigin || requestOrigin === allowed) {
      allowOrigin = allowed
    }
  } else if (!requestOrigin) {
    // No SITE_URL and no browser Origin (native / Stripe) — omit wildcard for credentialed calls.
    allowOrigin = 'null'
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, stripe-signature',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

export function jsonResponse(body: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

export function textResponse(body: string, status = 200, req?: Request): Response {
  return new Response(body, {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
