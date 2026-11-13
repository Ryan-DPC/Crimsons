-- Billing Stripe (Premium mensuel / annuel).
-- Source de vérité runtime entitlement : public.profiles.is_premium
-- (allowlist email + abonnements Stripe actifs).
-- À valider avec fiduciaire/avocat pour TVA / CGV CH — voir docs/PAYMENTS.md.

create table if not exists public.stripe_customers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_customer_id text not null references public.stripe_customers (stripe_customer_id) on delete cascade,
  stripe_subscription_id text not null unique,
  stripe_price_id text not null,
  status text not null,
  cancel_at_period_end boolean not null default false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);
create index if not exists subscriptions_status_idx on public.subscriptions (status);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  stripe_customer_id text,
  stripe_invoice_id text unique,
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  amount_cents integer,
  currency text,
  status text not null,
  paid_at timestamptz,
  raw_event_type text,
  created_at timestamptz not null default now()
);

create index if not exists payments_user_id_idx on public.payments (user_id);
create unique index if not exists payments_checkout_session_uidx
  on public.payments (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

-- Idempotence webhook (éviter double application).
create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.stripe_webhook_events enable row level security;

-- Clients authentifiés : lecture de leurs propres lignes uniquement.
-- Écritures : service_role (Edge Functions webhook / checkout) uniquement.
revoke all on table public.stripe_customers from anon, authenticated;
revoke all on table public.subscriptions from anon, authenticated;
revoke all on table public.payments from anon, authenticated;
revoke all on table public.stripe_webhook_events from anon, authenticated;

grant select on table public.stripe_customers to authenticated;
grant select on table public.subscriptions to authenticated;
grant select on table public.payments to authenticated;

grant select, insert, update, delete on table public.stripe_customers to service_role;
grant select, insert, update, delete on table public.subscriptions to service_role;
grant select, insert, update, delete on table public.payments to service_role;
grant select, insert, update, delete on table public.stripe_webhook_events to service_role;

drop policy if exists stripe_customers_select_own on public.stripe_customers;
create policy stripe_customers_select_own
  on public.stripe_customers
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own
  on public.subscriptions
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists payments_select_own on public.payments;
create policy payments_select_own
  on public.payments
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Pas de policy SELECT sur stripe_webhook_events pour authenticated/anon.

create or replace function public.sync_premium_from_subscriptions(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  has_active boolean;
  allowlisted boolean;
begin
  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = p_user_id
      and s.status in ('active', 'trialing')
  ) into has_active;

  select exists (
    select 1
    from public.premium_email_allowlist a
    join auth.users u on lower(u.email) = a.email
    where u.id = p_user_id
  ) into allowlisted;

  update public.profiles
  set is_premium = (has_active or allowlisted)
  where id = p_user_id;
end;
$$;

revoke all on function public.sync_premium_from_subscriptions(uuid) from public;
grant execute on function public.sync_premium_from_subscriptions(uuid) to service_role;

comment on table public.stripe_customers is 'Mapping Supabase user_id → Stripe Customer (écrit par Edge Functions).';
comment on table public.subscriptions is 'Abonnements Stripe Premium ; alimente profiles.is_premium via sync_premium_from_subscriptions.';
comment on table public.payments is 'Journal des factures / checkout Stripe (audit, pas d''entitlement).';
