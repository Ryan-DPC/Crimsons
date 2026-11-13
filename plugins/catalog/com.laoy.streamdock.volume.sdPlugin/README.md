# Volume / Wave Link (`com.laoy.streamdock.volume.sdPlugin`)

Contrôle volume Windows (master + sessions par appli) et modèle multi-pistes prêt pour **Elgato Wave Link**.

## Architecture

```
StreamDock → crimson-server WS → { WASAPI sessions | Wave Link bridge stub }
Hub widget : master + liste pistes (mute / niveau)
```

Messages WS :

| Type | Direction | Rôle |
| --- | --- | --- |
| `VOLUME_STATE` | server → client | Snapshot master + tracks + `wavelink` |
| `VOLUME_COMMAND` | client → server | `endpoint` + `payload` |
| `WAVELINK_STATE` | server → client | Alias sous-ensemble Wave Link (découverte) |

## Actions StreamDock

### Couche A — Windows

| Action UUID | Endpoint | Effet |
| --- | --- | --- |
| `…master_up` | `master_up` | Master +5 % |
| `…master_down` | `master_down` | Master −5 % |
| `…master_mute` | `master_mute` | Toggle mute master |
| `…level` | (display + `refresh`) | Titre master + piste sélectionnée ; dial = scroll piste |
| `…refresh` | `refresh` | Relit sessions WASAPI + discovery WL |

### Couche B — Multi-pistes (sessions / Wave Link)

| Action UUID | Endpoint | Effet |
| --- | --- | --- |
| `…track_prev` / `…track_next` | `track_prev` / `track_next` | Scroll index de piste (wrap) |
| `…track_up` / `…track_down` | `track_up` / `track_down` | ± volume piste sélectionnée |
| `…track_mute` | `track_mute` | Mute piste sélectionnée |

Stratégie UX : **une piste sélectionnée** + scroll (touches ou dial sur Level) puis ± / mute — pas besoin d’une touche par piste.

## Wave Link — findings (nov. 2026)

**Pas d’API publique officielle.** En revanche, Wave Link **3.x** expose un WebSocket JSON-RPC **local non officiel**, reverse-engineered depuis le plugin Stream Deck Elgato :

| Élément | Détail |
| --- | --- |
| Transport | JSON-RPC 2.0 over `ws://127.0.0.1:<port>` |
| Découverte | `%LOCALAPPDATA%\Packages\Elgato.WaveLink_*\LocalState\ws-info.json` |
| Fallback ports | `1884–1893` |
| Origin | `streamdeck://` (requis) |
| Auth | Aucune |
| Méthodes utiles | `getApplicationInfo`, `getChannels`, `getMixes`, `setChannel` (level/mute/mix), `setSubscription` |

Références communautaires :

- [Raphiiko/wavelink-ts PROTOCOL.md](https://github.com/Raphiiko/wavelink-ts/blob/main/PROTOCOL.md) (vérifié WL 3.1.1)
- [wavelink-adapter (PyPI)](https://pypi.org/project/wavelink-adapter/) (testé WL 3.2.5)
- [DarrellVS/node-wave-link-sdk](https://github.com/DarrellVS/node-wave-link-sdk)
- MIDI Mixer plugins (piste alternative via MIDI, pas d’API native)

### État dans Crimsons aujourd’hui

1. **Windows WASAPI** (master + sessions) — implémenté (Windows) ; mock multi-pistes sur Linux/CI.
2. **`wavelink::discover_state()`** — lit `ws-info.json` / probe ports ; remplit `VOLUME_STATE.wavelink` **sans** ouvrir encore le JSON-RPC.
3. **Client JSON-RPC** — non câblé (stub prêt : `jsonrpc_request`, constantes `WS_ORIGIN` / plage de ports).

### Comment brancher le client réel

1. Au refresh, si `wavelink.available && port`, ouvrir `ws://127.0.0.1:{port}` avec header `Origin: streamdeck://`.
2. `getApplicationInfo` → `setPluginInfo` → `getChannels` / `getMixes`.
3. Mapper `channels[]` vers `VolumeTrack { source: "wavelink" }` et préférer ces tracks aux sessions Windows quand `connected`.
4. `setChannel` pour level/mute ; s’abonner aux notifications pour le live.

## Limites

- Wave Link JSON-RPC = **non officiel** ; peut casser entre versions WL.
- Sur Linux VM : mock uniquement (pas de WASAPI / pas de WL).
- Sessions Windows ≠ mix monitor/stream séparés de Wave Link (un seul niveau par session jusqu’au bridge).
- Premium + sidecar Crimsons requis.

## Injection

```powershell
.\scripts\inject_plugins.ps1 -Extra com.laoy.streamdock.volume.sdPlugin
```
