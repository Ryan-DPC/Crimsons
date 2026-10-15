-- Catalogue plugins Crimsons (store web + API REST Supabase).
-- Crimsons ne livre aucun .sdPlugin ; le catalogue est la source de vérité.

create table if not exists public.plugin_categories (
  id text primary key,
  label text not null,
  description text not null default ''
);

create table if not exists public.plugin_catalog (
  id text primary key,
  slug text not null unique,
  name text not null,
  summary text not null default '',
  description text not null default '',
  package_id text not null unique,
  version text not null default '0.0.0',
  status text not null default 'coming_soon'
    check (status in ('published', 'coming_soon', 'deprecated')),
  pricing text not null default 'tbd'
    check (pricing in ('free', 'premium', 'paid', 'tbd')),
  categories text[] not null default '{}',
  surfaces text[] not null default '{}',
  requires_premium boolean not null default false,
  requires_crimsons boolean not null default true,
  icon_url text,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plugin_catalog_status_idx on public.plugin_catalog (status);
create index if not exists plugin_catalog_categories_idx on public.plugin_catalog using gin (categories);

alter table public.plugin_categories enable row level security;
alter table public.plugin_catalog enable row level security;

-- Lecture publique du catalogue (listing store).
drop policy if exists "plugin_categories_public_read" on public.plugin_categories;
create policy "plugin_categories_public_read"
  on public.plugin_categories for select
  to anon, authenticated
  using (true);

drop policy if exists "plugin_catalog_public_read" on public.plugin_catalog;
create policy "plugin_catalog_public_read"
  on public.plugin_catalog for select
  to anon, authenticated
  using (true);

revoke insert, update, delete on public.plugin_categories from anon, authenticated;
revoke insert, update, delete on public.plugin_catalog from anon, authenticated;
grant select on public.plugin_categories to anon, authenticated;
grant select on public.plugin_catalog to anon, authenticated;
grant select, insert, update, delete on public.plugin_categories to service_role;
grant select, insert, update, delete on public.plugin_catalog to service_role;

insert into public.plugin_categories (id, label, description) values
  ('streamdeck', 'StreamDock', 'Pack installable dans Stream Dock / StreamDeck (boutons physiques).'),
  ('game', 'Jeu', 'Automatisation et infos liées à un jeu (LCU, draft, live).'),
  ('utility', 'Utilitaire', 'Outils transverses hors jeu (raccourcis, automatisations).'),
  ('media', 'Médias', 'Lecture audio / vidéo et contrôles associés.'),
  ('communication', 'Communication', 'Voix, chat, présence (Discord, etc.).'),
  ('streaming', 'Streaming', 'Outils créateur / live (Twitch, ads, chat).'),
  ('smart-home', 'Maison connectée', 'Éclairage et périphériques domotiques.')
on conflict (id) do update set
  label = excluded.label,
  description = excluded.description;

insert into public.plugin_catalog (
  id, slug, name, summary, description, package_id, version, status, pricing,
  categories, surfaces, requires_premium, requires_crimsons, sort_order
) values
  (
    'league-of-legends', 'league-of-legends', 'League of Legends',
    'Auto-accept, pick/ban, stats et actions draft depuis StreamDock.',
    'Plugin StreamDock pour League of Legends via Crimsons : ready-check, pick/ban, champion, runes, dodge.',
    'com.laoy.streamdock.crimson.sdPlugin', '3.1.4', 'published', 'free',
    array['streamdeck','game'], array['streamdock','crimsons-hub'], false, true, 10
  ),
  (
    'spotify', 'spotify', 'Spotify',
    'Contrôle de lecture Spotify (play/pause, volume, playlists) sur StreamDock.',
    'Plugin StreamDock Spotify branché sur le sidecar Crimsons. OAuth Spotify géré dans l’app Crimsons.',
    'com.laoy.streamdock.spotify.sdPlugin', '3.1.4', 'published', 'premium',
    array['streamdeck','media','utility'], array['streamdock','crimsons-hub'], true, true, 20
  ),
  (
    'discord', 'discord', 'Discord',
    'Mute, deafen et contrôles vocaux Discord depuis StreamDock.',
    'Plugin StreamDock Discord optionnel. L’intégration Discord IPC dans Crimsons fonctionne aussi sans ce pack deck.',
    'com.laoy.streamdock.discord.sdPlugin', '1.1.0', 'published', 'premium',
    array['streamdeck','communication','utility'], array['streamdock','crimsons-hub'], true, true, 30
  ),
  (
    'philips-hue', 'philips-hue', 'Philips Hue',
    'Contrôle d’éclairage Hue depuis StreamDock (bientôt).',
    'Stub catalogue — scènes et toggle lumière. Non installable tant que le runtime n’est pas branché.',
    'com.laoy.streamdock.hue.sdPlugin', '3.1.0', 'coming_soon', 'tbd',
    array['streamdeck','smart-home','utility'], array['streamdock'], true, true, 40
  ),
  (
    'twitch', 'twitch', 'Twitch',
    'Chat, ads et viewers Twitch depuis StreamDock (bientôt).',
    'Stub catalogue — actions créateur Twitch. Non installable tant que le runtime n’est pas branché.',
    'com.laoy.streamdock.twitch.sdPlugin', '3.1.0', 'coming_soon', 'tbd',
    array['streamdeck','streaming','communication'], array['streamdock'], true, true, 50
  )
on conflict (id) do update set
  slug = excluded.slug,
  name = excluded.name,
  summary = excluded.summary,
  description = excluded.description,
  package_id = excluded.package_id,
  version = excluded.version,
  status = excluded.status,
  pricing = excluded.pricing,
  categories = excluded.categories,
  surfaces = excluded.surfaces,
  requires_premium = excluded.requires_premium,
  requires_crimsons = excluded.requires_crimsons,
  sort_order = excluded.sort_order,
  updated_at = now();
