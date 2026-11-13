# Philips Hue (`com.laoy.streamdock.hue.sdPlugin`)

Contrôle d’éclairage **Philips Hue** (pièces / groupes, luminosité, scènes) via le sidecar Crimsons.

## Architecture

```
StreamDock → crimson-server WS → { Hue CLIP v1 local | mock }
Hub widget : pièce sélectionnée + on/off / bri ± / scènes
```

Messages WS :

| Type | Direction | Rôle |
| --- | --- | --- |
| `HUE_STATE` | server → client | Snapshot groups + scenes + sélection |
| `HUE_COMMAND` | client → server | `endpoint` + `payload` |

Prefs Hub : `plugins.hue` (premium). Catalogue slug : `philips-hue` · **5.99 CHF/mois** · StreamDock ✓ · Elgato ✗.

## Bridge local

| Variable | Rôle |
| --- | --- |
| `HUE_BRIDGE_IP` | IP LAN du bridge |
| `HUE_USERNAME` | Username API local (bouton link) |
| `HUE_MOCK=1` | Force le mock même avec credentials |

Sans credentials (VM Linux / CI) → **mock** déterministe (Living Room, Bedroom, Gaming Den + scènes).

API utilisée : CLIP v1 HTTP `http://{ip}/api/{user}/groups|scenes` et `PUT …/groups/{id}/action`.

## Actions StreamDock

| Action UUID | Endpoint | Effet |
| --- | --- | --- |
| `…toggle` | `toggle` | On/off pièce sélectionnée |
| `…bri_up` / `…bri_down` | `bri_up` / `bri_down` | Luminosité ± (~10 %) |
| `…room_prev` / `…room_next` | `room_prev` / `room_next` | Scroll pièce / groupe |
| `…scene_prev` / `…scene_next` | `scene_prev` / `scene_next` | Scroll + apply scène |
| `…ct_preset` | `ct_preset` | Preset température couleur (stub) |
| `…status` | display + `refresh` | Titre pièce / bri / scène ; dial = bri |
| `…refresh` | `refresh` | Relit bridge ou mock |
| `…openhub` | (URL) | Store `/plugins/philips-hue` |

## Limites

- CLIP v1 uniquement (pas encore CLIP v2 / Entertainment).
- Pas de pairing automatique du username (env manuel).
- CT preset = stub (warm / cool / neutral mireds).
- Sur Linux VM : mock uniquement sans bridge.
- Premium + sidecar Crimsons requis.
- Pack Elgato non supporté (`hardware.elgato: false`).

## Injection

```powershell
.\scripts\inject_plugins.ps1 -Extra com.laoy.streamdock.hue.sdPlugin
```

Le stub historique sous `plugins/streamdeck/optional/` reste ; le pack MVP vit sous `plugins/catalog/`.
