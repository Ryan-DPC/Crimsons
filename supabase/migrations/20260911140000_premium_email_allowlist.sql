-- Whitelist d'emails Premium (pas de géoloc). Compte existant + futurs signups.

create table if not exists public.premium_email_allowlist (
  email text primary key,
  note text,
  created_at timestamptz not null default now()
);

alter table public.premium_email_allowlist enable row level security;

-- Pas d'accès client : seulement service_role / SQL dashboard / triggers SECURITY DEFINER.
revoke all on table public.premium_email_allowlist from anon, authenticated;
grant select, insert, update, delete on table public.premium_email_allowlist to service_role;

insert into public.premium_email_allowlist (email, note)
values (lower('ryandepina@icloud.com'), 'owner')
on conflict (email) do nothing;

-- Compte déjà créé : Premium immédiat.
update public.profiles p
set is_premium = true
from auth.users u
where p.id = u.id
  and lower(u.email) in (select email from public.premium_email_allowlist);

-- Sur création de profil (après le trigger handle_new_user habituel).
create or replace function public.grant_premium_if_allowlisted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_email text;
begin
  select lower(email) into user_email
  from auth.users
  where id = new.id;

  if user_email is not null and exists (
    select 1 from public.premium_email_allowlist a where a.email = user_email
  ) then
    new.is_premium := true;
  end if;

  return new;
end;
$$;

revoke all on function public.grant_premium_if_allowlisted() from public;

drop trigger if exists on_profile_grant_premium_allowlist on public.profiles;
create trigger on_profile_grant_premium_allowlist
  before insert on public.profiles
  for each row
  execute function public.grant_premium_if_allowlisted();
