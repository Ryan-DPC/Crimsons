use std::net::SocketAddr;
use tokio::net::{TcpListener, TcpStream};
use futures_util::{StreamExt, SinkExt};
use serde_json::json;
use std::sync::Arc;
use crate::storage;
use crate::events::WsSender;
use crate::sd_commands::StreamDeckCommand;
use crate::spotify::SpotifyService;
use crate::discord::DiscordService;
use crate::hue::HueService;
use crate::twitch::TwitchService;

pub async fn start_ws_server(
    sender: WsSender, 
    spotify_service: Arc<SpotifyService>, 
    discord_service: Arc<DiscordService>, 
    hue_service: Arc<HueService>,
    twitch_service: Arc<TwitchService>,
    db: Arc<crate::db::StreamDockDB>,
    is_lol_enabled: Arc<std::sync::atomic::AtomicBool>
) {
    let is_auto_accept_enabled = Arc::new(std::sync::atomic::AtomicBool::new(true));
    start_ws_server_modular(40510, sender, Some(spotify_service), Some(discord_service), Some(hue_service), Some(twitch_service), db, is_lol_enabled, is_auto_accept_enabled).await;
}

pub async fn start_ws_server_modular(
    port: u16,
    sender: WsSender, 
    spotify_service: Option<Arc<SpotifyService>>, 
    discord_service: Option<Arc<DiscordService>>, 
    hue_service: Option<Arc<HueService>>,
    twitch_service: Option<Arc<TwitchService>>,
    db: Arc<crate::db::StreamDockDB>,
    is_lol_enabled: Arc<std::sync::atomic::AtomicBool>,
    is_auto_accept_enabled: Arc<std::sync::atomic::AtomicBool>
) {
    // Ecoute sur les deux adresses de bouclage. Sous Windows, "localhost"
    // resout vers ::1 avant 127.0.0.1 : un client qui utilise le nom plutot que
    // l'adresse litterale se voyait refuser la connexion, alors que le serveur
    // tournait. L'ecoute IPv6 est facultative, son echec n'est pas bloquant.
    let addr = format!("127.0.0.1:{}", port)
        .parse::<SocketAddr>()
        .expect("Invalid address");

    let listener_v6 = match format!("[::1]:{}", port).parse::<SocketAddr>() {
        Ok(a6) => match TcpListener::bind(&a6).await {
            Ok(l) => {
                tracing::info!("WebSocket server listening on [::1]:{}", port);
                Some(l)
            }
            Err(e) => {
                tracing::warn!("Ecoute IPv6 impossible sur [::1]:{} ({}), 127.0.0.1 seule", port, e);
                None
            }
        },
        Err(_) => None,
    };

    match TcpListener::bind(&addr).await {
        Ok(listener) => {
            // Fusionne les deux ecoutes : chaque connexion est traitee de facon
            // identique, quelle que soit l'adresse par laquelle elle arrive.
            if let Some(l6) = listener_v6 {
                let s = WsSender(sender.0.clone());
                let sp = spotify_service.clone();
                let di = discord_service.clone();
                let hu = hue_service.clone();
                let tw = twitch_service.clone();
                let db6 = db.clone();
                let lol6 = is_lol_enabled.clone();
                let aa6 = is_auto_accept_enabled.clone();
                tokio::spawn(async move {
                    accept_loop(l6, s, sp, di, hu, tw, db6, lol6, aa6).await;
                });
            }

            tracing::info!("WebSocket server listening on {}", addr);
            accept_loop(
                listener, sender, spotify_service, discord_service, hue_service,
                twitch_service, db, is_lol_enabled, is_auto_accept_enabled,
            ).await;
            tracing::error!("WebSocket listener accept loop exited!");
        },
        Err(e) => tracing::error!("Failed to bind to {}: {}", addr, e),
    }
}

/// Portee demandee a Spotify. Identique a celle de l'application, pour qu'un
/// jeton obtenu par un chemin serve a l'autre.
const SPOTIFY_SCOPES: &str = "user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-modify-public playlist-modify-private playlist-read-private";

/// Extrait un parametre de la premiere ligne d'une requete HTTP.
fn query_param(request: &str, key: &str) -> Option<String> {
    let line = request.lines().next()?;
    let query = line.split('?').nth(1)?.split_whitespace().next()?;
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        if k == key && !v.is_empty() { Some(v.to_string()) } else { None }
    })
}

fn http_header<'a>(request: &'a str, name: &str) -> Option<&'a str> {
    for line in request.lines() {
        let Some((k, v)) = line.split_once(':') else { continue };
        if k.eq_ignore_ascii_case(name) {
            let v = v.trim();
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    None
}

fn cors_headers(request: &str) -> String {
    match http_header(request, "Origin") {
        Some(o) if is_remote_web_origin(o) => String::new(),
        Some(o) => format!("Access-Control-Allow-Origin: {}\r\nVary: Origin\r\n", o),
        None => "Access-Control-Allow-Origin: *\r\n".to_string(),
    }
}

fn reject_remote_web(request: &str) -> bool {
    http_header(request, "Origin").is_some_and(is_remote_web_origin)
}

fn http_forbidden(request: &str) -> String {
    format!(
        "HTTP/1.1 403 Forbidden\r\n{}Content-Type: text/plain\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: 9\r\n\r\nForbidden",
        cors_headers(request)
    )
}

/// Boucle d'acceptation, partagee par les ecoutes IPv4 et IPv6.
async fn accept_loop(
    listener: TcpListener,
    sender: WsSender,
    spotify_service: Option<Arc<SpotifyService>>,
    discord_service: Option<Arc<DiscordService>>,
    hue_service: Option<Arc<HueService>>,
    twitch_service: Option<Arc<TwitchService>>,
    db: Arc<crate::db::StreamDockDB>,
    is_lol_enabled: Arc<std::sync::atomic::AtomicBool>,
    is_auto_accept_enabled: Arc<std::sync::atomic::AtomicBool>,
) {
    while let Ok((stream, _)) = listener.accept().await {
        let sender_clone = WsSender(sender.0.clone());
        let spotify_clone = spotify_service.clone();
        let discord_clone = discord_service.clone();
        let hue_clone = hue_service.clone();
        let twitch_clone = twitch_service.clone();
        let db_clone = db.clone();
        let is_lol_enabled_clone = is_lol_enabled.clone();
        let is_auto_accept_enabled_clone = is_auto_accept_enabled.clone();
        tokio::spawn(async move {
            // Peek for HTTP GET (Spotify Callback)
            let mut buffer = [0; 1024];
            if stream.peek(&mut buffer).await.is_ok() {
                let request = String::from_utf8_lossy(&buffer);

                // Point d'entree de l'autorisation Spotify, utilise par les
                // plugins StreamDock. Le plugin d'origine visait un composant
                // Mirabox sur le port 26433, absent ici : le serveur prend le
                // relais et mene le flux OAuth de bout en bout, sans exiger que
                // l'application soit ouverte.
                // Secrets never travel in the query string. GET uses credentials
                // already stored in data.json / spotify_cache; POST accepts a JSON
                // body { clientId, clientSecret } from the property inspector.
                // Local-only WS auth bootstrap for StreamDock HTML plugins that
                // cannot read %APPDATA%\com.laoy.crimsons\auth.token (no Node/ActiveX).
                // Bound to 127.0.0.1 already — same trust boundary as the token file.
                if request.starts_with("GET /local/ws-token") {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut stream = stream;
                    let mut drop_buf = [0; 4096];
                    let _ = stream.read(&mut drop_buf).await;
                    let response = if reject_remote_web(&request) {
                        http_forbidden(&request)
                    } else {
                        let token = crate::auth::current_token().unwrap_or_default();
                        let cors = cors_headers(&request);
                        if token.is_empty() {
                            format!("HTTP/1.1 404 Not Found\r\n{cors}Content-Type: text/plain\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
                        } else {
                            format!(
                                "HTTP/1.1 200 OK\r\n{cors}Content-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                                token.len(),
                                token
                            )
                        }
                    };
                    let _ = stream.write_all(response.as_bytes()).await;
                    let _ = stream.shutdown().await;
                    return;
                }

                if request.starts_with("OPTIONS /authorization") {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut stream = stream;
                    let mut drop_buf = [0; 4096];
                    let _ = stream.read(&mut drop_buf).await;
                    let cors = cors_headers(&request);
                    let response = if reject_remote_web(&request) {
                        http_forbidden(&request)
                    } else {
                        format!("HTTP/1.1 204 No Content\r\n{cors}Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
                    };
                    let _ = stream.write_all(response.as_bytes()).await;
                    let _ = stream.shutdown().await;
                    return;
                }
                if request.starts_with("GET /authorization") || request.starts_with("POST /authorization") {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let is_post = request.starts_with("POST ");
                    if reject_remote_web(&request) {
                        let mut stream = stream;
                        let mut drop_buf = [0; 4096];
                        let _ = stream.read(&mut drop_buf).await;
                        let _ = stream.write_all(http_forbidden(&request).as_bytes()).await;
                        let _ = stream.shutdown().await;
                        return;
                    }
                    let mut stream = stream;
                    let mut drop_buf = [0; 8192];
                    let n = stream.read(&mut drop_buf).await.unwrap_or(0);
                    let raw = String::from_utf8_lossy(&drop_buf[..n]);

                    let mut id = String::new();
                    let mut secret = String::new();

                    if is_post {
                        if let Some(body) = raw.split("\r\n\r\n").nth(1) {
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(body.trim()) {
                                id = json["clientId"].as_str()
                                    .or_else(|| json["client_id"].as_str())
                                    .unwrap_or("")
                                    .to_string();
                                secret = json["clientSecret"].as_str()
                                    .or_else(|| json["client_secret"].as_str())
                                    .unwrap_or("")
                                    .to_string();
                            }
                        }
                    }

                    // Prefer disk-backed credentials; never read clientSecret from the query.
                    if id.is_empty() || secret.is_empty() {
                        let data = storage::load_data_from_path(storage::get_data_path_from_env());
                        if id.is_empty() {
                            id = data.spotify_client_id.clone();
                        }
                        if secret.is_empty() {
                            secret = data.spotify_client_secret.clone();
                        }
                    }
                    if id.is_empty() || secret.is_empty() {
                        if let Some(s) = &spotify_clone {
                            let (cid, csec, _) = s.get_credentials().await;
                            if id.is_empty() { id = cid; }
                            if secret.is_empty() { secret = csec; }
                        }
                    }
                    // Optional clientId in query is OK (public); secret in query is ignored.
                    if id.is_empty() {
                        if let Some(qid) = query_param(&request, "clientId") {
                            id = qid;
                        }
                    }

                    let response = if !id.is_empty() && !secret.is_empty() {
                        tracing::info!("[SPOTIFY] Autorisation demandee, identifiants charges depuis le store local");
                        if let Some(s) = &spotify_clone {
                            s.set_client_credentials(id.clone(), secret).await;
                        }
                        let auth_url = format!(
                            "https://accounts.spotify.com/authorize?response_type=code&client_id={}&redirect_uri={}&scope={}",
                            id,
                            urlencoding::encode("http://127.0.0.1:40510/callback"),
                            urlencoding::encode(SPOTIFY_SCOPES)
                        );
                        if is_post {
                            let body = json!({ "redirect": auth_url }).to_string();
                            format!(
                                "HTTP/1.1 200 OK\r\n{}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                                cors_headers(&request),
                                body.len(), body
                            )
                        } else {
                            format!("HTTP/1.1 302 Found\r\nLocation: {}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n", auth_url)
                        }
                    } else {
                        tracing::warn!("[SPOTIFY] Autorisation demandee sans identifiants en store");
                        let body = "<html><body style='background:#111;color:white;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;'><div><h1>Identifiants manquants</h1><p>Renseignez le Client ID et le Client Secret dans Crimsons ou le Property Inspector.</p></div></body></html>";
                        format!("HTTP/1.1 400 Bad Request\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body)
                    };
                    let _ = stream.write_all(response.as_bytes()).await;
                    let _ = stream.shutdown().await;
                    return;
                }

                if request.starts_with("GET /callback") {
                    tracing::info!("[SPOTIFY] Callback HTTP recu sur le serveur");
                    if let Some(code_start) = request.find("code=") {
                        let code = request[code_start + 5..].split_whitespace().next().unwrap_or("");
                        let code = code.split('&').next().unwrap_or(code);
                        tracing::info!("[SPOTIFY] Code d'autorisation extrait");

                        // Exchange on the server first (single-use code). Only
                        // notify the app after success so it does not race a
                        // second exchange that would invalidate the grant.
                        let exchange_ok = if let Some(s) = &spotify_clone {
                            match s.exchange_code(code.to_string()).await {
                                Ok(_) => {
                                    tracing::info!("[SPOTIFY] Echange du code reussi cote serveur, jetons enregistres");
                                    let _ = sender_clone.0.send(json!({
                                        "type": "SPOTIFY_CALLBACK_RESULT",
                                        "ok": true
                                    }).to_string());
                                    true
                                }
                                Err(e) => {
                                    tracing::warn!("[SPOTIFY] Echange du code refuse cote serveur : {}", e);
                                    let _ = sender_clone.0.send(json!({
                                        "type": "SPOTIFY_CALLBACK_RESULT",
                                        "ok": false,
                                        "error": e.to_string()
                                    }).to_string());
                                    false
                                }
                            }
                        } else {
                            // No in-process Spotify service — fall back to the app.
                            let _ = sender_clone.0.send(json!({ "type": "SPOTIFY_CALLBACK_CODE", "code": code }).to_string());
                            false
                        };

                        use tokio::io::{AsyncReadExt, AsyncWriteExt};
                        let mut stream = stream;
                        let mut drop_buf = [0; 4096];
                        let _ = stream.read(&mut drop_buf).await; // Consume the incoming HTTP request headers to prevent TCP RST on close
                        let body = if exchange_ok {
                            "<html><body style='background:#111;color:white;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;'><div style='text-align:center'><h1 style='color:#22c55e'>Spotify connecté</h1><p>Vous pouvez fermer cette fenêtre.</p></div></body></html>"
                        } else {
                            "<html><body style='background:#111;color:white;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;'><div style='text-align:center'><h1 style='color:#ef4444'>Échec de connexion Spotify</h1><p>Réessayez depuis Crimsons → Paramètres (identifiants Client ID / Secret).</p></div></body></html>"
                        };
                        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                        let _ = stream.write_all(response.as_bytes()).await;
                        let _ = stream.shutdown().await;
                        return;
                    }
                    tracing::warn!("[SPOTIFY] Callback recu sans parametre code");
                }
            }
            handle_connection(stream, sender_clone, spotify_clone, discord_clone, hue_clone, twitch_clone, db_clone, is_lol_enabled_clone, is_auto_accept_enabled_clone).await;
        });
    }
}

/// Vrai si l'origine designe la machine locale. Couvre la webview Tauri, qui
/// se presente sous http://tauri.localhost sur Windows, et les plugins
/// StreamDock, charges depuis des fichiers locaux.
/// Strip bearer / refresh tokens from WS payloads before they hit the log file.
fn redact_ws_payload_for_log(value: &serde_json::Value) -> String {
    const SENSITIVE: &[&str] = &[
        "access_token",
        "refresh_token",
        "token",
        "client_secret",
        "authorization",
        "password",
    ];
    let mut cloned = value.clone();
    if let Some(obj) = cloned.as_object_mut() {
        for key in SENSITIVE {
            if let Some(v) = obj.get_mut(*key) {
                if v.as_str().map(|s| !s.is_empty()).unwrap_or(false) {
                    *v = serde_json::Value::String("***".to_string());
                }
            }
        }
    }
    cloned.to_string()
}

fn is_local_origin(origin: &str) -> bool {
    let lower = origin.trim().to_ascii_lowercase();

    // Les plugins StreamDock s'annoncent "file://" : leur interface est un
    // fichier HTML local, donc un programme local. Une page web distante ne
    // peut pas presenter cette origine, le navigateur ne l'autorise pas.
    if lower == "file://" || lower.starts_with("file:") {
        return true;
    }

    // "null" est volontairement refuse : une page distante dans une iframe
    // bac a sable l'envoie aussi, ce n'est donc pas une preuve de localite.

    let host = origin
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(origin);
    let host = host.split('/').next().unwrap_or("");
    // Retire le port sans casser une adresse IPv6 entre crochets.
    let host = match host.rfind(':') {
        Some(i) if !host[i..].contains(']') => &host[..i],
        _ => host,
    };
    let host = host.trim_end_matches('.').to_ascii_lowercase();

    host == "localhost"
        || host == "127.0.0.1"
        || host == "[::1]"
        || host == "::1"
        || host.ends_with(".localhost")
}

/// Browser fetch from a non-local website. `file://`, `null` (file pages) and a
/// missing Origin stay allowed so StreamDock HTML inspectors keep working.
fn is_remote_web_origin(origin: &str) -> bool {
    let t = origin.trim();
    if t.is_empty() {
        return false;
    }
    let lower = t.to_ascii_lowercase();
    if lower == "null" || lower == "file://" || lower.starts_with("file:") {
        return false;
    }
    !is_local_origin(t)
}

#[cfg(test)]
mod origin_tests {
    use super::{is_local_origin, is_remote_web_origin, redact_ws_payload_for_log, reject_remote_web};
    use serde_json::json;

    #[test]
    fn redact_ws_payload_masque_les_jetons() {
        let raw = json!({
            "type": "AUTH_SESSION",
            "access_token": "super-secret",
            "refresh_token": "also-secret",
            "plugin": "spotify"
        });
        let redacted = redact_ws_payload_for_log(&raw);
        assert!(redacted.contains("***"));
        assert!(!redacted.contains("super-secret"));
        assert!(!redacted.contains("also-secret"));
        assert!(redacted.contains("spotify"));
    }

    #[test]
    fn accepte_les_plugins_streamdock() {
        // Leur interface est un fichier HTML local. Ce cas manquait, et tous
        // les plugins se retrouvaient refuses.
        assert!(is_local_origin("file://"));
        assert!(is_local_origin("file:///C:/Users/x/plugin/index.html"));
    }

    #[test]
    fn refuse_une_origine_nulle() {
        // Une page distante dans une iframe bac a sable envoie aussi "null".
        assert!(!is_local_origin("null"));
    }

    #[test]
    fn accepte_les_clients_legitimes() {
        // Webview Tauri (Windows), serveur de dev Vite, pages locales.
        assert!(is_local_origin("http://tauri.localhost"));
        assert!(is_local_origin("https://tauri.localhost"));
        assert!(is_local_origin("tauri://localhost"));
        assert!(is_local_origin("http://localhost:5173"));
        assert!(is_local_origin("http://127.0.0.1:40510"));
        assert!(is_local_origin("http://[::1]:8080"));
    }

    #[test]
    fn refuse_les_pages_distantes() {
        assert!(!is_local_origin("https://evil.com"));
        assert!(!is_local_origin("http://example.org:8080"));
        assert!(is_remote_web_origin("https://evil.com"));
        assert!(is_remote_web_origin("http://example.org:8080"));
        assert!(!is_remote_web_origin("file://"));
        assert!(!is_remote_web_origin("null"));
        assert!(!is_remote_web_origin("http://127.0.0.1:40510"));
        assert!(reject_remote_web("POST /authorization HTTP/1.1\r\nOrigin: https://evil.com\r\n\r\n"));
        assert!(!reject_remote_web("POST /authorization HTTP/1.1\r\nOrigin: file://\r\n\r\n"));
        assert!(!reject_remote_web("POST /authorization HTTP/1.1\r\n\r\n"));
    }

    #[test]
    fn resiste_aux_origines_trompeuses() {
        // Sous-domaine qui imite localhost sans en etre un.
        assert!(!is_local_origin("https://localhost.evil.com"));
        // Chemin qui ressemble a un hote local.
        assert!(!is_local_origin("https://evil.com/localhost"));
        // Identifiants dans l'URL, hote reel a droite du @.
        assert!(!is_local_origin("https://evil.com#localhost"));
    }
}

async fn handle_connection(
    stream: TcpStream,
    sender: WsSender,
    spotify: Option<Arc<SpotifyService>>, 
    discord: Option<Arc<DiscordService>>, 
    hue: Option<Arc<HueService>>,
    twitch: Option<Arc<TwitchService>>,
    db: Arc<crate::db::StreamDockDB>,
    is_lol_enabled: Arc<std::sync::atomic::AtomicBool>,
    is_auto_accept_enabled: Arc<std::sync::atomic::AtomicBool>
) {

    // Les navigateurs autorisent les WebSocket vers 127.0.0.1 sans CORS : sans
    // ce controle, n'importe quelle page web visitee peut piloter le serveur.
    // Un navigateur envoie toujours Origin et ne peut pas le falsifier ; les
    // clients natifs (application Tauri, plugins StreamDock) n'en envoient pas.
    let origin_check = |req: &tokio_tungstenite::tungstenite::handshake::server::Request,
                        res: tokio_tungstenite::tungstenite::handshake::server::Response| {
        let forbid = |motif: &str| {
            let mut err = tokio_tungstenite::tungstenite::handshake::server::ErrorResponse::new(
                Some(motif.to_string()),
            );
            *err.status_mut() = tokio_tungstenite::tungstenite::http::StatusCode::FORBIDDEN;
            err
        };

        if let Some(origin) = req.headers().get("origin").and_then(|v| v.to_str().ok()) {
            if !is_local_origin(origin) {
                tracing::warn!("[WS] Connexion refusee, origine externe : {}", origin);
                return Err(forbid("Origin not allowed"));
            }
        }

        // Jeton passe en parametre d'URL : l'API WebSocket des navigateurs ne
        // permet pas d'en-tetes personnalises, et les plugins StreamDock sont
        // dans ce cas.
        let token = req
            .uri()
            .query()
            .and_then(|q| {
                q.split('&').find_map(|pair| {
                    let (k, v) = pair.split_once('=')?;
                    if k == "token" {
                        Some(urlencoding::decode(v).unwrap_or(std::borrow::Cow::Borrowed(v)).into_owned())
                    } else {
                        None
                    }
                })
            })
            .unwrap_or_default();

        if !crate::auth::verify(&token) {
            if crate::auth::strict_mode() {
                tracing::warn!("[WS] Connexion refusee, jeton absent ou invalide");
                return Err(forbid("Invalid token"));
            }
            // Strict est ON par defaut ; CRIMSON_STRICT_AUTH=0 desactive le refus.
            tracing::warn!("[WS] Connexion sans jeton valide acceptee (mode non strict)");
        }

        Ok(res)
    };

    if let Ok(mut ws_stream) = tokio_tungstenite::accept_hdr_async(stream, origin_check).await {
        tracing::info!("[WS] New client connection accepted");
        tracing::info!("");
        
        let (ws_stream_sender, mut ws_stream_receiver) = tokio::sync::mpsc::channel::<String>(100);
        // Load persistent data to push initial state
        let data_path = storage::get_data_path_from_env();
        let data = storage::load_data_from_path(data_path);
        
        // Push initial state immediately
        let initial_state = json!({
            "type": "AUTO_ACCEPT_STATE",
            "enabled": data.auto_accept
        });
        let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(initial_state.to_string().into())).await;

        // Push auto_ban / auto_pick (active selection, not remembered-only)
        let auto_ban_id = data.effective_auto_ban().unwrap_or(0);
        let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(
            json!({ "type": "AUTO_BAN_STATE", "championId": auto_ban_id }).to_string().into()
        )).await;

        let auto_pick_id = data.effective_auto_pick().unwrap_or(0);
        let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(
            json!({ "type": "AUTO_PICK_STATE", "championId": auto_pick_id }).to_string().into()
        )).await;

        // Push heartbeat immediately
        let heartbeat = json!({
            "type": "HEARTBEAT_STATUS",
            "server": true,
            "lol": is_lol_enabled.load(std::sync::atomic::Ordering::Relaxed) && crate::lcu::is_lcu_connected(),
            "discord": if let Some(d) = &discord { d.is_enabled.load(std::sync::atomic::Ordering::Relaxed) && d.is_connected().await } else { false }
        });
        let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(heartbeat.to_string().into())).await;

        // Reconcile Spotify association for the UI even when Hub toggle is OFF
        // (background poll is paused → otherwise Settings stays "Non connecté").
        if let Some(s) = &spotify {
            let snap = s.auth_snapshot_state().await;
            let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(
                json!({ "type": "SPOTIFY_STATE", "data": snap }).to_string().into()
            )).await;
        }

        // Push plugin prefs + live entitlement so Hub matches disk/server truth.
        {
            let plugins = data.other.get("plugins").cloned().unwrap_or(json!({}));
            let premium = crate::entitlement::is_premium().await;
            let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(
                json!({
                    "type": "PLUGIN_PREFS",
                    "plugins": plugins,
                    "premium": premium,
                    "spotify_enabled": spotify.as_ref().map(|s| s.is_enabled.load(std::sync::atomic::Ordering::Relaxed)).unwrap_or(false),
                    "discord_enabled": discord.as_ref().map(|d| d.is_enabled.load(std::sync::atomic::Ordering::Relaxed)).unwrap_or(false),
                    "lol_enabled": is_lol_enabled.load(std::sync::atomic::Ordering::Relaxed),
                }).to_string().into()
            )).await;
        }

        // Si le sidecar a deja une session (autostart), l'UI l'adopte avant
        // d'essayer un refresh localStorage perime.
        if let Some((access, refresh)) = crate::entitlement::exported_tokens() {
            let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(
                json!({
                    "type": "AUTH_SESSION_UPDATED",
                    "access_token": access,
                    "refresh_token": refresh,
                }).to_string().into()
            )).await;
        }

        // Push current LCU state if connected
        if crate::lcu::is_lcu_connected() {
            if let Ok(phase_str) = crate::lcu::lcu_request_async("GET".into(), "/lol-gameflow/v1/gameflow-phase".into(), None).await {
                if let Ok(phase) = serde_json::from_str::<serde_json::Value>(&phase_str) {
                    if let Some(p) = phase.as_str() {
                        let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(json!({ "type": "GAME_PHASE", "phase": p }).to_string().into())).await;
                        if p == "ChampSelect" {
                            if let Ok(cs_str) = crate::lcu::lcu_request_async("GET".into(), "/lol-champ-select/v1/session".into(), None).await {
                                if let Ok(session) = serde_json::from_str::<serde_json::Value>(&cs_str) {
                                    let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(json!({ "type": "CHAMP_SELECT_UPDATE", "data": session.clone() }).to_string().into())).await;
                                    
                                    let my_cell_id = session["localPlayerCellId"].as_i64().unwrap_or(-1);
                                    let mut my_champ_id = 0;
                                    let mut my_champ_name = String::new();
                                    
                                    if let Some(actions) = session["actions"].as_array() {
                                        for group in actions {
                                            if let Some(group_arr) = group.as_array() {
                                                for action in group_arr {
                                                    if action["actorCellId"].as_i64() == Some(my_cell_id) {
                                                        my_champ_id = action["championId"].as_u64().unwrap_or(0) as u32;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    if my_champ_id > 0 {
                                        if let Ok(champ_json) = crate::lcu::lcu_request_async("GET".into(), format!("/lol-game-data/assets/v1/champions/{}.json", my_champ_id), None).await {
                                            if let Ok(champ_data) = serde_json::from_str::<serde_json::Value>(&champ_json) {
                                                my_champ_name = champ_data["name"].as_str().unwrap_or("").to_string();
                                            }
                                        }
                                    }
                                    let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(json!({
                                        "type": "CHAMP_SELECT", 
                                        "championId": my_champ_id,
                                        "championName": my_champ_name
                                    }).to_string().into())).await;
                                }
                            }
                        }
                    }
                }
            }
        }

        if let Some(last_rank) = data.other.get("last_rank") {
            let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(last_rank.to_string().into())).await;
        }

        if let Some(last_summoner) = data.other.get("last_summoner") {
            let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(last_summoner.to_string().into())).await;
        }

        let mut rx = sender.0.subscribe();

        loop {
            tokio::select! {
                // Outgoing messages to this client (direct)
                out_msg = ws_stream_receiver.recv() => {
                    if let Some(text) = out_msg {
                        let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(text.into())).await;
                    } else {
                        break;
                    }
                }
                // Broadcasted messages (heartbeats, state updates)
                broadcast_msg = rx.recv() => {
                    if let Ok(text) = broadcast_msg {
                        let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(text.into())).await;
                    }
                }
                msg = ws_stream.next() => {
                    match msg {
                        Some(Ok(msg)) => {
                            if let Ok(text) = msg.into_text() {
                                if text.trim().is_empty() { continue; }
                                // Parse Command and Dispatch
                                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                                    // 1. Log incoming command for diagnostics
                                    let evt_name = value["event"].as_str().unwrap_or("N/A");
                                    let type_name = value["type"].as_str().unwrap_or("N/A");
                                     
                                    // Universal Settings Extraction
                                    if let Some(ctx) = value["context"].as_str() {
                                        if let Some(settings) = value["payload"]["settings"]
                                            .as_object()
                                            .or_else(|| value["payload"].as_object())
                                        {
                                            tracing::info!("[DEBUG SETTINGS] Received for context {}: {:?}", ctx, settings);
                                            
                                            // 1. Persist settings in-memory
                                            for bridge in crate::streamdock::ACTIVE_BRIDGES.iter_mut() {
                                                let mut s = bridge.settings_per_ctx.lock().await;
                                                s.insert(ctx.to_string(), serde_json::Value::Object(settings.clone()));
                                            }

                                            // 2. Persist to DB (v1.2.0)
                                            let db_c = db.clone();
                                            let ctx_c = ctx.to_string();
                                            let settings_c = serde_json::Value::Object(settings.clone());
                                            let action_c = value["action"].as_str().map(|s| s.to_string());
                                            let img_c = settings.get("image").and_then(|v| v.as_str())
                                                .or_else(|| settings.get("playlist_image").and_then(|v| v.as_str()))
                                                .map(|s| s.to_string());
                                            
                                            tokio::spawn(async move {
                                                let _ = db_c.save_button(&ctx_c, action_c.as_deref(), &settings_c, img_c.as_deref());
                                            });

                                            // 3. IMMEDIATE IMAGE PUSH (v1.1.5)
                                            if let Some(img_url) = settings.get("image").and_then(|v| v.as_str())
                                                .or_else(|| settings.get("playlist_image").and_then(|v| v.as_str())) {
                                                
                                                tracing::info!("[SD IMAGE PUSH] Pushing cover to context {}", ctx);
                                                let bridge_tx = ws_stream_sender.clone();
                                                let ctx_str = ctx.to_string();
                                                let img_str = img_url.to_string();
                                                tokio::spawn(async move {
                                                    let _ = bridge_tx.send(json!({
                                                        "event": "setImage",
                                                        "context": ctx_str,
                                                        "payload": { "image": img_str, "target": 0 }
                                                    }).to_string()).await;
                                                });

                                                // ALSO push to all active hardware bridges (Proxy Bridge)
                                                for bridge in crate::streamdock::ACTIVE_BRIDGES.iter() {
                                                    let tx_clone = bridge.tx.clone();
                                                    let ctx_str2 = ctx.to_string();
                                                    let img_str2 = img_url.to_string();
                                                    tokio::spawn(async move {
                                                        let _ = tx_clone.send(json!({
                                                            "event": "setImage",
                                                            "context": ctx_str2,
                                                            "payload": { "image": img_str2, "target": 0 }
                                                        }).to_string()).await;
                                                    });
                                                }
                                            }
                                        }
                                        // Update context mapping if action is present
                                        if let Some(action) = value["action"].as_str() {
                                            for bridge in crate::streamdock::ACTIVE_BRIDGES.iter_mut() {
                                                let mut c = bridge.contexts.lock().await;
                                                c.insert(ctx.to_string(), action.to_string());
                                            }
                                        }
                                    }

                                    // Never log raw payloads: AUTH_SESSION / SPOTIFY_AUTH carry
                                    // bearer tokens. Redact sensitive fields before printing.
                                    tracing::info!(
                                        "[SD IN] Event: {} Type: {} Payload: {}",
                                        evt_name,
                                        type_name,
                                        redact_ws_payload_for_log(&value)
                                    );

                                    if value["type"] == "TOGGLE_PLUGIN" {
                                        if let (Some(plugin), Some(enabled)) = (value["plugin"].as_str(), value["enabled"].as_bool()) {
                                            // Sans ce controle, n'importe quel client WebSocket
                                            // local activait un service premium d'un seul message.
                                            // Hue / Twitch APIs are not implemented — never enable them.
                                            if plugin == "hue" || plugin == "twitch" {
                                                let msg = if plugin == "hue" {
                                                    crate::hue::UNAVAILABLE_MSG
                                                } else {
                                                    crate::twitch::UNAVAILABLE_MSG
                                                };
                                                if let Some(h) = &hue { h.is_enabled.store(false, std::sync::atomic::Ordering::Relaxed); }
                                                if let Some(t) = &twitch { t.is_enabled.store(false, std::sync::atomic::Ordering::Relaxed); }
                                                tracing::warn!("[AUTH] Blocked TOGGLE_PLUGIN {}: {}", plugin, msg);
                                                let _ = sender.0.send(json!({
                                                    "type": "FEATURE_UNAVAILABLE",
                                                    "plugin": plugin,
                                                    "message": msg
                                                }).to_string());
                                                continue;
                                            }
                                            if enabled
                                                && ["spotify", "discord"].contains(&plugin)
                                                && !crate::entitlement::is_premium().await
                                            {
                                                tracing::warn!("[AUTH] Blocked TOGGLE_PLUGIN {} for free user", plugin);
                                                let _ = sender.0.send(json!({ "type": "AUTH_ERROR", "message": "Abonnement Premium Requis" }).to_string());
                                                continue;
                                            }
                                            // Toggle in-memory states
                                            match plugin {
                                                "spotify" => {
                                                    if let Some(s) = &spotify {
                                                        s.is_enabled.store(enabled, std::sync::atomic::Ordering::Relaxed);
                                                        if !enabled {
                                                            // Keep has_token accurate — disabling the Hub
                                                            // toggle must not look like a disconnect.
                                                            let has_token = {
                                                                let client = s.get_client();
                                                                let lock = client.read().await;
                                                                lock.access_token.is_some() || lock.refresh_token.is_some()
                                                            };
                                                            let idle = crate::spotify::SpotifyState {
                                                                has_token,
                                                                ..Default::default()
                                                            };
                                                            let _ = sender.0.send(json!({ "type": "SPOTIFY_STATE", "data": idle }).to_string());
                                                        } else {
                                                            s.notify.notify_one();
                                                        }
                                                    }
                                                }
                                                "discord" => {
                                                    if let Some(d) = &discord {
                                                        d.is_enabled.store(enabled, std::sync::atomic::Ordering::Relaxed);
                                                        if !enabled {
                                                            let empty_state = crate::discord::DiscordState::default();
                                                            let _ = sender.0.send(json!({ "type": "DISCORD_STATE", "data": empty_state }).to_string());
                                                        }
                                                    }
                                                }
                                                "leagueOfLegends" => {
                                                    is_lol_enabled.store(enabled, std::sync::atomic::Ordering::Relaxed);
                                                    if !enabled {
                                                        let _ = sender.0.send(json!({ "type": "GAME_PHASE", "phase": "None" }).to_string());
                                                        let _ = sender.0.send(json!({ "type": "CHAMP_SELECT", "championId": 0, "championName": "" }).to_string());
                                                        let _ = sender.0.send(json!({ "type": "SUMMONER_INFO", "gameName": "", "profileIconId": 0 }).to_string());
                                                    }
                                                }
                                                _ => {}
                                            }
                                            tracing::info!("Toggled plugin {} to {} in memory", plugin, enabled);

                                            // Immediate heartbeat broadcast for snappy visual updates
                                            let hb = json!({
                                                "type": "HEARTBEAT_STATUS",
                                                "server": true,
                                                "lol": is_lol_enabled.load(std::sync::atomic::Ordering::Relaxed) && crate::lcu::is_lcu_connected(),
                                                "discord": if let Some(d) = &discord { d.is_enabled.load(std::sync::atomic::Ordering::Relaxed) && d.is_connected().await } else { false }
                                            }).to_string();
                                            let _ = sender.0.send(hb);
                                        }
                                        continue;
                                    }

                                    if value["type"] == "GET_VERSION" {
                                        let _ = sender.0.send(json!({
                                            "type": "SERVER_VERSION",
                                            "version": env!("CARGO_PKG_VERSION")
                                        }).to_string());
                                        continue;
                                    }

                                    if value["type"] == "UPDATE_RESOURCE_MODE" {
                                        if let Some(low) = value["low_resource"].as_bool() {
                                            crate::state::set_low_resource_mode(low);
                                            tracing::info!("");
                                        }
                                        continue;
                                    }

                                    // Session Supabase transmise par l'application. Acces en
                                    // memoire ; le refresh est conserve pour StreamDock au boot.
                                    if value["type"] == "AUTH_SESSION" {
                                        // Seul le jeton vient du client. L'URL de verification est
                                        // figee dans le binaire : la laisser au client reviendrait a
                                        // le laisser choisir qui atteste de ses propres droits.
                                        match value["access_token"].as_str() {
                                            Some(token) if !token.is_empty() => {
                                                // Le jeton de rafraichissement permet au serveur de
                                                // se reauthentifier seul au demarrage suivant.
                                                let refresh = value["refresh_token"]
                                                    .as_str()
                                                    .filter(|t| !t.is_empty())
                                                    .map(|t| t.to_string());
                                                crate::entitlement::set_session(token.to_string(), refresh);
                                            }
                                            _ => {
                                                // Ne jamais effacer le refresh sur un AUTH_SESSION
                                                // vide : une course UI (session pas encore hydratee)
                                                // cassait le premium StreamDock et desactivait les
                                                // services. La deconnexion explicite utilise AUTH_LOGOUT.
                                                tracing::debug!("[AUTH] AUTH_SESSION sans jeton ignore (pas de clear)");
                                            }
                                        }
                                        continue;
                                    }

                                    if value["type"] == "AUTH_SESSION_GET" {
                                        if let Some((access, refresh)) =
                                            crate::entitlement::exported_tokens()
                                        {
                                            let _ = ws_stream_sender
                                                .send(
                                                    json!({
                                                        "type": "AUTH_SESSION_UPDATED",
                                                        "access_token": access,
                                                        "refresh_token": refresh,
                                                    })
                                                    .to_string(),
                                                )
                                                .await;
                                        }
                                        continue;
                                    }

                                    if value["type"] == "AUTH_LOGOUT" {
                                        crate::entitlement::clear_session();
                                        continue;
                                    }

                                    if value["type"] == "SYNC_STATE" {
                                        // Client asked to re-pull server truth after reconnect.
                                        if let Some(s) = &spotify {
                                            let snap = s.auth_snapshot_state().await;
                                            let _ = sender.0.send(json!({ "type": "SPOTIFY_STATE", "data": snap }).to_string());
                                        }
                                        let data_path = storage::get_data_path_from_env();
                                        let data = storage::load_data_from_path(data_path);
                                        let plugins = data.other.get("plugins").cloned().unwrap_or(json!({}));
                                        let premium = crate::entitlement::is_premium().await;
                                        let _ = sender.0.send(json!({
                                            "type": "PLUGIN_PREFS",
                                            "plugins": plugins,
                                            "premium": premium,
                                            "spotify_enabled": spotify.as_ref().map(|s| s.is_enabled.load(std::sync::atomic::Ordering::Relaxed)).unwrap_or(false),
                                            "discord_enabled": discord.as_ref().map(|d| d.is_enabled.load(std::sync::atomic::Ordering::Relaxed)).unwrap_or(false),
                                            "lol_enabled": is_lol_enabled.load(std::sync::atomic::Ordering::Relaxed),
                                        }).to_string());
                                        continue;
                                    }

                                    // Credentials-only sync from the app (no tokens). Keeps the
                                    // sidecar cache aligned with data.json without URL query params.
                                    if value["type"] == "SPOTIFY_CREDENTIALS" {
                                        if let Some(s) = &spotify {
                                            if let (Some(id), Some(secret)) = (value["client_id"].as_str(), value["client_secret"].as_str()) {
                                                if !id.is_empty() && !secret.is_empty() {
                                                    s.set_client_credentials(id.to_string(), secret.to_string()).await;
                                                    tracing::info!("[SPOTIFY] Identifiants client mis a jour via WS");
                                                }
                                            }
                                        }
                                        continue;
                                    }

                                    if value["type"] == "SPOTIFY_AUTH" {
                                        if let (Some(access), Some(refresh)) = (value["access_token"].as_str(), value["refresh_token"].as_str()) {
                                            let expires_in = value["expires_in"].as_u64().unwrap_or(3600);
                                            if let Some(s) = &spotify {
                                                // Les identifiants viennent de l'application Spotify de
                                                // l'utilisateur. Ils doivent etre enregistres avant les
                                                // jetons : sans eux, ensure_valid_token() ne peut pas
                                                // rafraichir l'acces une fois l'heure ecoulee.
                                                if let (Some(id), Some(secret)) = (value["client_id"].as_str(), value["client_secret"].as_str()) {
                                                    if !id.is_empty() && !secret.is_empty() {
                                                        s.set_client_credentials(id.to_string(), secret.to_string()).await;
                                                    }
                                                }
                                                s.update_tokens(access.to_string(), refresh.to_string(), expires_in).await;
                                                let _ = sender.0.send(json!({
                                                    "type": "SPOTIFY_STATE",
                                                    "data": crate::spotify::SpotifyState {
                                                        has_token: true,
                                                        ..Default::default()
                                                    }
                                                }).to_string());
                                                s.notify.notify_one();
                                                tracing::info!("[SPOTIFY] Jetons mis a jour via SPOTIFY_AUTH");
                                            }
                                        }
                                        continue;
                                    }

                                    if value["type"] == "DEBUG_LOG" {
                                        tracing::info!("");
                                        continue;
                                    }

                                    let cmd_type = value["type"].as_str().unwrap_or("");
                                    if ["SPOTIFY_COMMAND", "DISCORD_COMMAND", "HUE_COMMAND", "TWITCH_COMMAND"].contains(&cmd_type) {
                                        // Le verdict vient de Supabase, plus de data.json : ce
                                        // fichier est ecrit par le client et modifiable a la main.
                                        if !crate::entitlement::is_premium().await {
                                            tracing::warn!("[AUTH] Blocked {} for free user", cmd_type);
                                            let _ = sender.0.send(json!({ "type": "AUTH_ERROR", "message": "Abonnement Premium Requis" }).to_string());
                                            continue;
                                        }
                                    }

                                    if value["type"] == "SPOTIFY_COMMAND" {
                                        if let Some(s) = &spotify {
                                            if !s.is_enabled.load(std::sync::atomic::Ordering::Relaxed) {
                                                tracing::info!("[SPOTIFY] Spotify command ignored: service disabled");
                                                continue;
                                            }
                                            if let Some(endpoint) = value["endpoint"].as_str() {
                                                let command_val = value.clone();
                                                let s_clone = s.clone();
                                                let endpoint_str = endpoint.to_string();
                                                tokio::spawn(async move {
                                                    // Fallback to persisted settings if payload is empty (v1.1.5)
                                                    if let Some(ctx) = command_val["context"].as_str() {
                                                        let mut payload = command_val["payload"].clone();
                                                        if payload["playlist"].is_null() && payload["uri"].is_null() {
                                                            for bridge in crate::streamdock::ACTIVE_BRIDGES.iter() {
                                                                let settings_lock = bridge.settings_per_ctx.lock().await;
                                                                if let Some(s_settings) = settings_lock.get(ctx) {
                                                                    tracing::info!("[SD CMD] Falling back to persisted settings for context {}", ctx);
                                                                    payload = s_settings.clone();
                                                                }
                                                            }
                                                        }
                                                        
                                                        if endpoint_str == "play" {
                                                            if let Some(uri) = payload["playlist"].as_str().or(payload["uri"].as_str()) {
                                                                let mut p = payload.clone();
                                                                p["context_uri"] = json!(uri);
                                                                let _ = s_clone.handle_command(&endpoint_str, Some(p)).await;
                                                            } else {
                                                                tracing::info!("[SD ERROR] Play command missing playlist/uri");
                                                            }
                                                        } else {
                                                            let _ = s_clone.handle_command(&endpoint_str, Some(payload)).await;
                                                        }
                                                    } else {
                                                        let _ = s_clone.handle_command(&endpoint_str, Some(command_val.clone())).await;
                                                    }
                                                });
                                            }
                                        }
                                        continue;
                                    }
 
                                    if value["type"] == "DISCORD_COMMAND" {
                                        if let Some(d) = &discord {
                                            if !d.is_enabled.load(std::sync::atomic::Ordering::Relaxed) {
                                                tracing::info!("[DISCORD] Discord command ignored: service disabled");
                                                continue;
                                            }
                                            if let Some(endpoint) = value["endpoint"].as_str() {
                                                let d_clone = d.clone();
                                                let endpoint_str = endpoint.to_string();
                                                let val_clone = value.clone();
                                                tokio::spawn(async move {
                                                    let _ = d_clone.handle_command(&endpoint_str, Some(val_clone)).await;
                                                });
                                            }
                                        }
                                        continue;
                                    }
 
                                    if value["type"] == "HUE_COMMAND" {
                                        tracing::warn!("[HUE] {}", crate::hue::UNAVAILABLE_MSG);
                                        let _ = sender.0.send(json!({
                                            "type": "FEATURE_UNAVAILABLE",
                                            "plugin": "hue",
                                            "message": crate::hue::UNAVAILABLE_MSG
                                        }).to_string());
                                        continue;
                                    }

                                    if value["type"] == "TWITCH_COMMAND" {
                                        tracing::warn!("[TWITCH] {}", crate::twitch::UNAVAILABLE_MSG);
                                        let _ = sender.0.send(json!({
                                            "type": "FEATURE_UNAVAILABLE",
                                            "plugin": "twitch",
                                            "message": crate::twitch::UNAVAILABLE_MSG
                                        }).to_string());
                                        continue;
                                    }

                                    if value["type"] == "REGISTER_STREAMDOCK_BRIDGE" {
                                        let port_id = value["port"].as_u64()
                                            .or_else(|| value["port"].as_str().and_then(|s| s.parse::<u64>().ok()));

                                        if let (Some(_p), Some(u)) = (port_id, value["uuid"].as_str()) {
                                            tracing::info!("");
                                            let s_clone = spotify.clone();
                                            let d_clone = discord.clone();
                                            let h_clone = hue.clone();
                                            let t_clone = twitch.clone();
                                            let uuid_str = u.to_string();
                                            let sender_clone = ws_stream_sender.clone();
                                            let contexts = std::sync::Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
                                            let pi_contexts = std::sync::Arc::new(tokio::sync::Mutex::new(std::collections::HashSet::new()));
                                            let last_state_cache = std::sync::Arc::new(tokio::sync::Mutex::new(None));
                                            let last_image_per_ctx = std::sync::Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
                                            let settings_per_ctx = std::sync::Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
                                            
                                            let bridge_data = crate::streamdock::HardwareBridge {
                                                tx: sender_clone.clone(),
                                                alive: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)),
                                                contexts: contexts.clone(),
                                                last_state_cache: last_state_cache.clone(),
                                                pi_contexts: pi_contexts.clone(),
                                                last_image_per_ctx: last_image_per_ctx.clone(),
                                                settings_per_ctx: settings_per_ctx.clone(),
                                                hue: h_clone.clone().unwrap_or_else(|| Arc::new(HueService::new(sender.clone()))),
                                                twitch: t_clone.clone().unwrap_or_else(|| Arc::new(TwitchService::new(sender.clone()))),
                                            };

                                            // RESTORE FROM DB (v1.2.0)
                                            if let Ok(saved_buttons) = db.get_all_buttons() {
                                                let mut settings_lock = settings_per_ctx.lock().await;
                                                let mut contexts_lock = contexts.lock().await;
                                                for (ctx, action, mut settings, image) in saved_buttons {
                                                    // v1.2.3: Merge image into settings for better sync persistence
                                                    if let Some(img) = &image {
                                                        if let Some(obj) = settings.as_object_mut() {
                                                            if !obj.contains_key("image") { obj.insert("image".to_string(), json!(img)); }
                                                            if !obj.contains_key("playlist_image") { obj.insert("playlist_image".to_string(), json!(img)); }
                                                        }
                                                    }

                                                    settings_lock.insert(ctx.clone(), settings.clone());
                                                    contexts_lock.insert(ctx.clone(), action);
                                                    
                                                    // Push image if saved
                                                    if let Some(img) = image {
                                                        let _ = sender_clone.send(json!({
                                                            "event": "setImage",
                                                            "context": ctx,
                                                            "payload": { "image": img, "target": 0 }
                                                        }).to_string()).await;
                                                    }
                                                }
                                            }

                                            crate::streamdock::ACTIVE_BRIDGES.insert(uuid_str.clone(), bridge_data);
                                            
                                            // IMMEDIATE SYNC: Push credentials and playlists as soon as the bridge connects
                                            let sync_val = json!({ "event": "registerPropertyInspector", "uuid": &uuid_str });
                                            let s_unwrapped = s_clone.clone().unwrap_or_else(|| Arc::new(SpotifyService::new(sender.clone())));
                                            let d_unwrapped = d_clone.clone().unwrap_or_else(|| Arc::new(DiscordService::new(sender.clone())));
                                            let h_unwrapped = h_clone.clone().unwrap_or_else(|| Arc::new(HueService::new(sender.clone())));
                                            let t_unwrapped = t_clone.clone().unwrap_or_else(|| Arc::new(TwitchService::new(sender.clone())));
                                            crate::streamdock::process_streamdeck_event(sync_val, s_unwrapped.clone(), d_unwrapped.clone(), sender_clone.clone(), contexts.clone(), pi_contexts.clone(), last_state_cache.clone(), settings_per_ctx.clone(), h_unwrapped.clone(), t_unwrapped.clone(), db.clone()).await;

                                            loop {
                                                tokio::select! {
                                                    msg_res = ws_stream.next() => {
                                                        match msg_res {
                                                            Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
                                                                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                                                                    crate::streamdock::process_streamdeck_event(val, s_unwrapped.clone(), d_unwrapped.clone(), sender_clone.clone(), contexts.clone(), pi_contexts.clone(), last_state_cache.clone(), settings_per_ctx.clone(), h_unwrapped.clone(), t_unwrapped.clone(), db.clone()).await;
                                                                }
                                                            }
                                                            _ => break,
                                                        }
                                                    }
                                                    Ok(broadcast_msg) = rx.recv() => {
                                                        if let Err(_) = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(broadcast_msg.into())).await {
                                                            break;
                                                        }
                                                    }
                                                }
                                            }
                                            crate::streamdock::ACTIVE_BRIDGES.remove(&uuid_str);
                                            tracing::info!("");
                                            break;
                                        }
                                    }

                                     if value["event"] == "registerPropertyInspector" {
                                        let s_clone = spotify.clone();
                                        let ws_sender = ws_stream_sender.clone();
                                        let broadcast = sender.0.clone();
                                        tokio::spawn(async move {
                                            if let Some(s) = s_clone {
                                                let playlists = s.get_user_playlists().await.unwrap_or_default();
                                                let devices = s.get_user_devices().await.unwrap_or_default();
                                                let data = json!({
                                                    "event": "sendToPropertyInspector",
                                                    "payload": {
                                                        "playlists": playlists,
                                                        "devices": devices,
                                                        "authorized": true
                                                    }
                                                });
                                                let text = data.to_string();
                                                let _ = ws_sender.send(text.clone()).await;
                                                let _ = broadcast.send(text);
                                            }
                                        });
                                        continue;
                                    }

                                    // AJAZZ / HTML plugin owns the StreamDock socket and forwards
                                    // PI events over crimson WS. Push playlists/devices back so
                                    // the plugin can ui.send(sendToPropertyInspector) to StreamDock.
                                    {
                                        let evt = value["event"].as_str().unwrap_or("");
                                        let action = value["action"].as_str().unwrap_or("");
                                        let pi_refresh = evt == "sendToPlugin"
                                            && matches!(
                                                value["payload"]["type"].as_str(),
                                                Some("refresh") | Some("requestPiData")
                                            );
                                        if action.starts_with("com.laoy.streamdock.spotify")
                                            && (evt == "propertyInspectorDidAppear" || pi_refresh)
                                        {
                                            let s_clone = spotify.clone();
                                            let ctx = value["context"].as_str().unwrap_or("").to_string();
                                            let act = action.to_string();
                                            let ws_sender = ws_stream_sender.clone();
                                            let broadcast = sender.0.clone();
                                            tokio::spawn(async move {
                                                let (playlists, devices, authorized, error) = if let Some(s) = s_clone {
                                                    if !crate::entitlement::is_premium().await {
                                                        tracing::warn!("[SPOTIFY] PI data blocked: premium required");
                                                        (vec![], vec![], false, Some("premium_required"))
                                                    } else {
                                                        let playlists = s.get_user_playlists().await.unwrap_or_default();
                                                        let devices = s.get_user_devices().await.unwrap_or_default();
                                                        (playlists, devices, true, None)
                                                    }
                                                } else {
                                                    (vec![], vec![], false, Some("spotify_unavailable"))
                                                };
                                                let mut payload = json!({
                                                    "playlists": playlists,
                                                    "devices": devices,
                                                    "authorized": authorized
                                                });
                                                if let Some(err) = error {
                                                    payload["error"] = json!(err);
                                                }
                                                let data = json!({
                                                    "event": "sendToPropertyInspector",
                                                    "context": ctx,
                                                    "action": act,
                                                    "payload": payload
                                                });
                                                let text = data.to_string();
                                                let _ = ws_sender.send(text.clone()).await;
                                                let _ = broadcast.send(text);
                                                tracing::info!(
                                                    "[SPOTIFY] PI data pushed ({} playlists, {} devices, authorized={})",
                                                    playlists.len(),
                                                    devices.len(),
                                                    authorized
                                                );
                                            });
                                            continue;
                                        }
                                    }

                                    if value["type"] == "REGISTER_STREAMDOCK" {
                                        let port_opt = value["port"].as_u64()
                                            .or_else(|| value["port"].as_str().and_then(|s| s.parse::<u64>().ok()));

                                        if let (Some(p), Some(u), Some(r)) = (port_opt, value["uuid"].as_str(), value["register_event"].as_str()) {
                                            tracing::info!("[SD HANDOVER] Port: {} UUID: {} Event: {}", p, u, r);
                                            let uuid_str = u.to_string();
                                            let reg_str = r.to_string();
                                            
                                            let s_clone = spotify.clone().unwrap_or_else(|| Arc::new(SpotifyService::new(sender.clone())));
                                            let d_clone = discord.clone().unwrap_or_else(|| Arc::new(DiscordService::new(sender.clone())));
                                            let h_clone = hue.clone().unwrap_or_else(|| Arc::new(crate::hue::HueService::new(sender.clone())));
                                            let t_clone = twitch.clone().unwrap_or_else(|| Arc::new(crate::twitch::TwitchService::new(sender.clone())));

                                            if !crate::streamdock::try_acquire_handover(
                                                p as u16, 
                                                uuid_str.clone(), 
                                                reg_str,
                                                s_clone,
                                                d_clone,
                                                h_clone,
                                                t_clone,
                                                db.clone(),
                                                sender.0.clone()
                                            ).await {
                                                tracing::info!("[SD HANDOVER] Duplicate or failed for {}", uuid_str);
                                            }

                                            let response_json = json!({
                                                "type": "COMMAND_ACK",
                                                "action": "REGISTER_STREAMDOCK",
                                                "status": "ok"
                                            });
                                            let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(response_json.to_string().into())).await;
                                            continue;
                                        }
                                    }

                                    if value["type"] == "FORWARD_TO_STREAMDOCK" {
                                         if let Some(payload) = value["payload"].as_object() {
                                             let payload_str = serde_json::Value::Object(payload.clone()).to_string();
                                             for bridge in crate::streamdock::ACTIVE_BRIDGES.iter() {
                                                 let _ = bridge.tx.send(payload_str.clone()).await;
                                             }
                                         }
                                         continue;
                                    }

                                    // Broadcast direct action requests from StreamDock so the Tauri UI can handle them
                                    // 4. Handle generic StreamDeck events (willAppear, etc.)
                                    if let Some(event) = value["event"].as_str() {
                                        if event == "willAppear" {
                                            if let (Some(ctx), Some(action)) = (value["context"].as_str(), value["action"].as_str()) {
                                                // Update context mapping
                                                for bridge in crate::streamdock::ACTIVE_BRIDGES.iter_mut() {
                                                    let mut c = bridge.contexts.lock().await;
                                                    c.insert(ctx.to_string(), action.to_string());
                                                    
                                                    // Update settings
                                                    if let Some(settings) = value["payload"]["settings"].as_object() {
                                                        let mut s = bridge.settings_per_ctx.lock().await;
                                                        s.insert(ctx.to_string(), serde_json::Value::Object(settings.clone()));
                                                    }
                                                }

                                                // Restore image from DB immediately on willAppear to solve starting cover art race
                                                if let Ok(Some(img)) = db.get_button_image(ctx) {
                                                    let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(json!({
                                                        "event": "setImage",
                                                        "context": ctx,
                                                        "payload": {
                                                            "image": img,
                                                            "target": 0
                                                        }
                                                    }).to_string().into())).await;
                                                }
                                            }
                                        }
                                        if event == "willDisappear" {
                                            if let Some(ctx) = value["context"].as_str() {
                                                for bridge in crate::streamdock::ACTIVE_BRIDGES.iter_mut() {
                                                    let mut c = bridge.contexts.lock().await;
                                                    c.remove(ctx);
                                                }
                                            }
                                        }
                                    }

                                     // UI → sidecar: set auto-accept without racing the AtomicBool
                                     if value["type"] == "SET_AUTO_ACCEPT" {
                                         if !is_lol_enabled.load(std::sync::atomic::Ordering::Relaxed) {
                                             tracing::info!("LCU SET_AUTO_ACCEPT ignored: service disabled");
                                             continue;
                                         }
                                         if let Some(enabled) = value["enabled"].as_bool() {
                                             is_auto_accept_enabled.store(enabled, std::sync::atomic::Ordering::Relaxed);
                                             let data_path = storage::get_data_path_from_env();
                                             let mut data = storage::load_data_from_path(data_path.clone());
                                             data.auto_accept = enabled;
                                             storage::save_data_to_path(data_path, &data);
                                             let _ = sender.0.send(json!({
                                                 "type": "AUTO_ACCEPT_STATE",
                                                 "enabled": enabled
                                             }).to_string());
                                         }
                                         continue;
                                     }

                                     // UI already persisted pick/ban via Tauri; relay for StreamDock + sync typed fields.
                                     if value["type"] == "AUTO_BAN_STATE" || value["type"] == "AUTO_PICK_STATE" {
                                         let data_path = storage::get_data_path_from_env();
                                         let mut data = storage::load_data_from_path(data_path.clone());
                                         let champ = value.get("championId").and_then(crate::automation::parse_champ_id);
                                         if value["type"] == "AUTO_BAN_STATE" {
                                             if let Some(id) = champ {
                                                 data.remembered_auto_ban = Some(id);
                                                 data.auto_ban = Some(id);
                                             } else {
                                                 data.auto_ban = None;
                                             }
                                             data.other.remove("autoBan");
                                         } else {
                                             if let Some(id) = champ {
                                                 data.remembered_auto_pick = Some(id);
                                                 data.auto_pick = Some(id);
                                             } else {
                                                 data.auto_pick = None;
                                             }
                                             data.other.remove("autoPick");
                                         }
                                         storage::save_data_to_path(data_path, &data);
                                         let _ = sender.0.send(text.clone());
                                         continue;
                                     }

                                     if value["type"] == "TOGGLE_AUTO_ACCEPT" {
                                         if !is_lol_enabled.load(std::sync::atomic::Ordering::Relaxed) {
                                             tracing::info!("LCU TOGGLE_AUTO_ACCEPT ignored: service disabled");
                                             continue;
                                         }
                                         // Toggle in-memory state and save to disk
                                         let new_val = !is_auto_accept_enabled.load(std::sync::atomic::Ordering::Relaxed);
                                         is_auto_accept_enabled.store(new_val, std::sync::atomic::Ordering::Relaxed);

                                         let data_path = storage::get_data_path_from_env();
                                         let mut data = storage::load_data_from_path(data_path.clone());
                                         data.auto_accept = new_val;
                                         storage::save_data_to_path(data_path, &data);

                                         let state_msg = json!({
                                             "type": "AUTO_ACCEPT_STATE",
                                             "enabled": new_val
                                         }).to_string();
                                         let _ = sender.0.send(state_msg);
                                         let response_json = json!({
                                             "type": "COMMAND_ACK",
                                             "action": "TOGGLE_AUTO_ACCEPT",
                                             "status": "ok"
                                         });
                                         let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(response_json.to_string().into())).await;
                                         continue;
                                     }


                                     if value["type"] == "TOGGLE_AUTO_BAN" || value["type"] == "TOGGLE_AUTO_PICK" || value["type"] == "INJECT_BUILD" || value["type"] == "DODGE_GAME" || value["type"] == "RUNE_BUILDS_READY" {
                                         if !is_lol_enabled.load(std::sync::atomic::Ordering::Relaxed) {
                                             tracing::info!("LCU command ignored: service disabled");
                                             continue;
                                         }
                                         // Forward non-mutation events to UI; ban/pick are applied here then
                                         // announced via AUTO_*_STATE so the UI does not double-toggle.
                                         if value["type"] != "TOGGLE_AUTO_BAN" && value["type"] != "TOGGLE_AUTO_PICK" {
                                             let _ = sender.0.send(text.clone());
                                         }
                                         
                                         // EXECUTE IN BACKEND
                                         if value["type"] == "TOGGLE_AUTO_BAN" {
                                             let data_path = storage::get_data_path_from_env();
                                             let mut data = storage::load_data_from_path(data_path.clone());
                                             
                                             if let Some(current) = data.effective_auto_ban() {
                                                 data.remembered_auto_ban = Some(current);
                                                 data.auto_ban = None;
                                             } else {
                                                 data.auto_ban = data.remembered_auto_ban.filter(|&id| id > 0);
                                             }
                                             // Clear legacy other keys so typed fields win
                                             data.other.remove("autoBan");
                                             data.other.remove("rememberedAutoBan");
                                             let auto_ban_val = data.auto_ban.map(|id| json!(id)).unwrap_or(json!(null));
                                             let _ = sender.0.send(json!({ "type": "AUTO_BAN_STATE", "championId": auto_ban_val }).to_string());
                                             
                                             storage::save_data_to_path(data_path, &data);
                                         } else if value["type"] == "TOGGLE_AUTO_PICK" {
                                             let data_path = storage::get_data_path_from_env();
                                             let mut data = storage::load_data_from_path(data_path.clone());
                                             
                                             if let Some(current) = data.effective_auto_pick() {
                                                 data.remembered_auto_pick = Some(current);
                                                 data.auto_pick = None;
                                             } else {
                                                 data.auto_pick = data.remembered_auto_pick.filter(|&id| id > 0);
                                             }
                                             data.other.remove("autoPick");
                                             data.other.remove("rememberedAutoPick");
                                             let auto_pick_val = data.auto_pick.map(|id| json!(id)).unwrap_or(json!(null));
                                             let _ = sender.0.send(json!({ "type": "AUTO_PICK_STATE", "championId": auto_pick_val }).to_string());
                                             
                                             storage::save_data_to_path(data_path, &data);
                                         } else if value["type"] == "DODGE_GAME" {
                                             // Handle dodge directly via LCU
                                             let _ = crate::lcu::lcu_request_async("POST".into(), "/lol-login/v1/session/invoke?destination=lcdsServiceProxy&method=call&args=[\"\",\"teambuilder-draft\",\"quitV2\",\"\"]".into(), Some("".into())).await;
                                             let _ = crate::lcu::lcu_request_async("POST".into(), "/lol-lobby/v1/lobby/custom/cancel-champ-select".into(), Some("".into())).await;
                                         }

                                         // Also directly acknowledge it
                                         let response_json = json!({
                                             "type": "COMMAND_ACK",
                                             "action": value["type"],
                                             "status": "ok"
                                         });
                                         let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(response_json.to_string().into())).await;
                                         continue;
                                     }

                                    if let Ok(command) = serde_json::from_str::<StreamDeckCommand>(&text) {
                                        // Simple command acknowledgement
                                        let response_json = json!({
                                            "type": "COMMAND_ACK",
                                            "action": command.action,
                                            "status": "ok"
                                        });
                                        let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(response_json.to_string().into())).await;
                                    }
                                } else {
                                    // Fallback: Log unknown JSON structure
                                    let log_path = crate::storage::get_data_dir().join("streamdock.log");
                                    if let Ok(mut log_file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
                                        use std::io::Write;
                                        let _ = writeln!(log_file, "[PRIMARY WS UNKNOWN] Payload: {}", text);
                                    }
                                    tracing::info!("");
                                }
                            }
                        }
                        _ => break,
                    }
                }
            }
        }
    }
}
