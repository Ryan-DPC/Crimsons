-- Add Apple Music (Cider) plugin to the public catalog.
insert into public.plugin_catalog (
  id, slug, name, summary, description, package_id, version, status, pricing,
  categories, surfaces, requires_premium, requires_crimsons, sort_order
) values (
  'apple-music', 'apple-music', 'Apple Music',
  'Contrôle Apple Music via Cider (play/pause, volume, shuffle) sur StreamDock.',
  'Plugin StreamDock branché sur l’API locale Cider (127.0.0.1:10767). Nécessite Cider + apptoken.',
  'com.laoy.streamdock.applemusic.sdPlugin', '0.1.0', 'published', 'premium',
  array['streamdeck','media','utility'], array['streamdock','crimsons-hub'], true, true, 25
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
