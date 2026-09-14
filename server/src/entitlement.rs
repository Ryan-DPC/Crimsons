//! Verification des droits premium.
//!
//! La decision ne peut pas reposer sur data.json : ce fichier est ecrit par le
//! client et modifiable au Bloc-notes. Elle est donc rattachee a la session
//! Supabase de l'utilisateur et verifiee aupres de Supabase lui-meme.
//!
//! Le jeton de rafraichissement est conserve sur disque pour que StreamDock
//! fonctionne sans l'application. Ce jeton ne peut servir qu'une fois : UI et
//! sidecar doivent donc partager le meme fichier, et le sidecar ne doit pas le
//! faire tourner tant que l'acces en cours reste valable. Sinon GoTrue revoque
//! toute la famille de session et l'application redemande un login.
//!
//! Ce que ce fichier contient n'est pas un verdict — un verdict sur disque
//! serait falsifiable, ce qui etait precisement le probleme de data.json. Il
//! contient une preuve d'identite que seul Supabase peut emettre, et qui reste
//! soumise a sa verification.
//!
//! Politique en cas de doute : refus. Pas de session, reseau coupe, reponse
//! inattendue de Supabase — dans tous ces cas l'acces premium est refuse.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

/// Duree pendant laquelle un verdict reste valable sans reinterroger Supabase.
const CACHE_TTL: Duration = Duration::from_secs(300);
const HTTP_TIMEOUT: Duration = Duration::from_secs(8);
/// Intervalle de reapplication du verdict aux services premium.
const GUARD_INTERVAL: Duration = Duration::from_secs(20);
/// Marge avant expiration JWT : on renouvelle seulement dans cette fenetre.
const EXPIRY_SKEW_SECS: i64 = 30;

/// Point de verification fige a la compilation (voir build.rs). Il ne doit
/// jamais venir du client : celui-ci pourrait designer un serveur complaisant.
const SUPABASE_URL: &str = env!("CRIMSON_SUPABASE_URL");
const SUPABASE_ANON_KEY: &str = env!("CRIMSON_SUPABASE_ANON_KEY");

/// Fichier ou la session survit aux redemarrages. Partage avec l'UI Tauri.
const SESSION_FILE: &str = "supabase_session.json";

#[derive(Clone)]
struct Session {
    access_token: String,
}

#[derive(Clone, Copy)]
struct Verdict {
    premium: bool,
    checked_at: Instant,
}

lazy_static::lazy_static! {
    static ref SESSION: RwLock<Option<Session>> = RwLock::new(None);
    static ref VERDICT: RwLock<Option<Verdict>> = RwLock::new(None);
    /// Reveille le garde-fou des qu'une session change, pour ne pas attendre
    /// GUARD_INTERVAL apres une connexion ou une deconnexion.
    static ref WAKE: tokio::sync::Notify = tokio::sync::Notify::new();
    static ref FILE_LOCK: Mutex<()> = Mutex::new(());
    static ref REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::new(());
    static ref WS_SENDER: RwLock<Option<tokio::sync::broadcast::Sender<String>>> =
        RwLock::new(None);
}

/// Permet d'annoncer a l'UI qu'un renouvellement a eu lieu, pour qu'elle
/// adopte les nouveaux jetons avant d'essayer l'ancien refresh (revoque).
pub fn set_ws_sender(tx: tokio::sync::broadcast::Sender<String>) {
    if let Ok(mut g) = WS_SENDER.write() {
        *g = Some(tx);
    }
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// `exp` d'un JWT, sans verifier la signature — on l'utilise seulement pour
/// savoir si un renouvellement est necessaire.
pub fn jwt_exp_unix(access_token: &str) -> Option<i64> {
    let payload = access_token.split('.').nth(1)?;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, engine::general_purpose::URL_SAFE, Engine};
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .ok()
        .or_else(|| URL_SAFE.decode(payload).ok())?;
    let json: Value = serde_json::from_slice(&decoded).ok()?;
    json.get("exp")?.as_i64()
}

/// True si l'acces peut encore etre presente a Supabase.
pub fn access_token_usable(
    access_token: &str,
    expires_at: Option<i64>,
    now: i64,
    skew_secs: i64,
) -> bool {
    if access_token.is_empty() {
        return false;
    }
    match expires_at.or_else(|| jwt_exp_unix(access_token)) {
        Some(exp) => exp - skew_secs > now,
        // Pas de date : on tente l'acces jusqu'a un 401, plutot que de faire
        // tourner le refresh a chaque demarrage du sidecar.
        None => true,
    }
}

pub fn refresh_token_from_value(v: &Value) -> Option<String> {
    v.get("refresh_token")?
        .as_str()
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
}

pub fn access_token_from_value(v: &Value) -> Option<String> {
    v.get("access_token")?
        .as_str()
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
}

/// Fusionne une reponse `/token` dans la session deja connue (pour garder
/// `user` et les autres champs ecrits par supabase-js).
pub fn apply_token_response(existing: Option<Value>, body: &Value) -> Result<Value, String> {
    let access = body
        .get("access_token")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "reponse sans access_token".to_string())?
        .to_string();
    let refresh = body
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| existing.as_ref().and_then(refresh_token_from_value))
        .ok_or_else(|| "reponse sans refresh_token".to_string())?;
    let expires_in = body.get("expires_in").and_then(|v| v.as_i64());
    let expires_at = body
        .get("expires_at")
        .and_then(|v| v.as_i64())
        .or_else(|| expires_in.map(|s| now_unix() + s));

    let mut root = existing.unwrap_or_else(|| json!({}));
    if !root.is_object() {
        root = json!({});
    }
    if let Some(user) = body.get("user") {
        if let Some(obj) = root.as_object_mut() {
            obj.insert("user".into(), user.clone());
        }
    }
    let obj = root.as_object_mut().expect("object");
    obj.insert("access_token".into(), json!(access));
    obj.insert("refresh_token".into(), json!(refresh));
    obj.insert("token_type".into(), json!("bearer"));
    if let Some(e) = expires_at {
        obj.insert("expires_at".into(), json!(e));
    }
    if let Some(e) = expires_in {
        obj.insert("expires_in".into(), json!(e));
    }
    Ok(root)
}

fn session_path() -> std::path::PathBuf {
    crate::storage::get_data_dir().join(SESSION_FILE)
}

fn read_session_value() -> Option<Value> {
    let _g = FILE_LOCK.lock().ok()?;
    let data = std::fs::read_to_string(session_path()).ok()?;
    serde_json::from_str(&data).ok()
}

fn write_session_value(value: &Value) -> Result<(), String> {
    let _g = FILE_LOCK
        .lock()
        .map_err(|e| format!("verrou session: {}", e))?;
    let path = session_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, value.to_string()).map_err(|e| e.to_string())
}

/// Contenu brut du fichier, pour l'UI Tauri (meme source que le sidecar).
pub fn read_session_json() -> Option<String> {
    let value = read_session_value()?;
    if refresh_token_from_value(&value).is_none() && access_token_from_value(&value).is_none() {
        return None;
    }
    Some(value.to_string())
}

/// Ecriture depuis l'UI (supabase-js persistSession). Met aussi a jour la
/// memoire pour ne pas representer un acces deja remplace.
pub fn write_session_json(json: &str) -> Result<(), String> {
    let value: Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    if refresh_token_from_value(&value).is_none() {
        return Err("session sans refresh_token".into());
    }
    write_session_value(&value)?;
    if let Some(access) = access_token_from_value(&value) {
        if let Ok(mut s) = SESSION.write() {
            *s = Some(Session {
                access_token: access,
            });
        }
    }
    Ok(())
}

/// Jetons a renvoyer a l'UI (connexion WS ou apres renouvellement).
pub fn exported_tokens() -> Option<(String, String)> {
    let value = read_session_value()?;
    Some((
        access_token_from_value(&value)?,
        refresh_token_from_value(&value)?,
    ))
}

fn persist_tokens(
    access_token: &str,
    refresh_token: &str,
    expires_at: Option<i64>,
    expires_in: Option<i64>,
) {
    let existing = read_session_value();
    let body = json!({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": expires_at,
        "expires_in": expires_in,
    });
    match apply_token_response(existing, &body) {
        Ok(merged) => {
            if let Err(e) = write_session_value(&merged) {
                tracing::warn!("[ENTITLEMENT] Ecriture de la session impossible : {}", e);
            } else {
                tracing::info!("[ENTITLEMENT] Session conservee pour les prochains demarrages");
            }
        }
        Err(e) => tracing::warn!("[ENTITLEMENT] Fusion de session impossible : {}", e),
    }
}

fn forget_session_file() {
    let _g = FILE_LOCK.lock();
    let _ = std::fs::remove_file(session_path());
}

fn remember_access(access_token: String) {
    if let Ok(mut s) = SESSION.write() {
        *s = Some(Session { access_token });
    }
}

fn broadcast_session_updated(access_token: &str, refresh_token: &str) {
    let payload = json!({
        "type": "AUTH_SESSION_UPDATED",
        "access_token": access_token,
        "refresh_token": refresh_token,
    })
    .to_string();
    if let Ok(g) = WS_SENDER.read() {
        if let Some(tx) = g.as_ref() {
            let _ = tx.send(payload);
        }
    }
}

/// Enregistre la session transmise par l'application apres authentification.
/// Seuls les jetons viennent du client : ils sont ensuite presentes a un point
/// de verification que le client ne choisit pas.
pub fn set_session(access_token: String, refresh_token: Option<String>) {
    remember_access(access_token.clone());
    if let Some(rt) = refresh_token.filter(|t| !t.is_empty()) {
        persist_tokens(
            &access_token,
            &rt,
            jwt_exp_unix(&access_token),
            None,
        );
    }
    invalidate();
    tracing::info!("[ENTITLEMENT] Session enregistree, verdict a revalider");
}

/// Echange le jeton de rafraichissement contre un acces neuf. Supabase renvoie
/// un nouveau jeton de rafraichissement a chaque appel : il faut le conserver,
/// l'ancien devenant invalide. L'UI est prevenue pour qu'elle n'utilise pas
/// l'ancien — sinon la detection de rejeu revoque toute la session.
async fn refresh_access_token(force: bool) -> Result<String, String> {
    let _refresh_guard = REFRESH_LOCK.lock().await;

    // Un autre appel a peut-etre deja renouvele pendant l'attente du verrou.
    if !force {
        if let Some(access) = usable_stored_access() {
            return Ok(access);
        }
    }

    let existing = read_session_value();
    let refresh = existing
        .as_ref()
        .and_then(refresh_token_from_value)
        .ok_or("aucun jeton de rafraichissement conserve")?;

    if SUPABASE_URL.is_empty() || SUPABASE_ANON_KEY.is_empty() {
        return Err("configuration Supabase absente du binaire".to_string());
    }

    let url = format!(
        "{}/auth/v1/token?grant_type=refresh_token",
        SUPABASE_URL.trim_end_matches('/')
    );

    let resp = reqwest::Client::new()
        .post(&url)
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Content-Type", "application/json")
        .timeout(HTTP_TIMEOUT)
        .body(serde_json::json!({ "refresh_token": refresh }).to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    if !status.is_success() {
        // 400 ou 401 : le jeton a ete revoque ou a expire. Le garder ne servirait
        // qu'a rejouer un echec a chaque demarrage.
        if status.as_u16() == 400 || status.as_u16() == 401 {
            forget_session_file();
            return Err(format!(
                "jeton de rafraichissement rejete ({}), session oubliee",
                status
            ));
        }
        return Err(format!("Supabase a repondu {}", status));
    }

    let json: Value = resp.json().await.map_err(|e| e.to_string())?;
    let merged = apply_token_response(existing, &json)?;
    write_session_value(&merged).map_err(|e| e.to_string())?;

    let access = access_token_from_value(&merged).ok_or("reponse sans access_token")?;
    let new_refresh = refresh_token_from_value(&merged).unwrap_or(refresh);
    remember_access(access.clone());
    broadcast_session_updated(&access, &new_refresh);
    tracing::info!("[ENTITLEMENT] Acces renouvele, UI notifiee");
    Ok(access)
}

fn usable_stored_access() -> Option<String> {
    let now = now_unix();
    if let Ok(guard) = SESSION.read() {
        if let Some(s) = guard.as_ref() {
            if access_token_usable(&s.access_token, None, now, EXPIRY_SKEW_SECS) {
                return Some(s.access_token.clone());
            }
        }
    }
    let disk = read_session_value()?;
    let access = access_token_from_value(&disk)?;
    let exp = disk.get("expires_at").and_then(|v| v.as_i64());
    if access_token_usable(&access, exp, now, EXPIRY_SKEW_SECS) {
        remember_access(access.clone());
        Some(access)
    } else {
        None
    }
}

/// Jeton d'acces courant, obtenu au besoin depuis le jeton conserve.
async fn current_access_token() -> Option<String> {
    if let Some(t) = usable_stored_access() {
        return Some(t);
    }
    match refresh_access_token(false).await {
        Ok(t) => Some(t),
        Err(e) => {
            tracing::warn!("[ENTITLEMENT] Renouvellement impossible : {}", e);
            None
        }
    }
}

/// Efface la session (deconnexion). Le premium retombe a false immediatement,
/// et le jeton conserve est supprime : sans cela le serveur se reconnecterait
/// tout seul au demarrage suivant, malgre la deconnexion.
pub fn clear_session() {
    if let Ok(mut s) = SESSION.write() {
        *s = None;
    }
    forget_session_file();
    invalidate();
    tracing::info!("[ENTITLEMENT] Session effacee");
}

fn invalidate() {
    if let Ok(mut v) = VERDICT.write() {
        *v = None;
    }
    WAKE.notify_waiters();
}

/// Applique en continu le verdict aux services premium.
///
/// Le client peut mentir dans data.json et envoyer TOGGLE_PLUGIN : cette boucle
/// ramene systematiquement chaque service a `droits && preference`. Les services
/// demarrent donc desactives et ne s'allument qu'une fois les droits confirmes.
pub fn start_guard(flags: Vec<(&'static str, Arc<AtomicBool>)>) {
    tokio::spawn(async move {
        loop {
            let premium = is_premium().await;
            let data = crate::storage::load_data_from_path(crate::storage::get_data_path_from_env());
            let prefs = data.other.get("plugins").cloned().unwrap_or(serde_json::Value::Null);

            for (name, flag) in &flags {
                let wanted = prefs.get(*name).and_then(|v| v.as_bool()).unwrap_or(false);
                let target = premium && wanted;
                if flag.swap(target, Ordering::Relaxed) != target {
                    tracing::info!("[ENTITLEMENT] service {} -> {}", name, target);
                }
            }

            tokio::select! {
                _ = tokio::time::sleep(GUARD_INTERVAL) => {}
                _ = WAKE.notified() => {}
            }
        }
    });
}

/// Verdict courant, reinterroge aupres de Supabase si le cache a expire.
pub async fn is_premium() -> bool {
    if let Ok(guard) = VERDICT.read() {
        if let Some(v) = *guard {
            if v.checked_at.elapsed() < CACHE_TTL {
                return v.premium;
            }
        }
    }

    let token = match current_access_token().await {
        Some(t) => t,
        None => {
            tracing::warn!("[ENTITLEMENT] Aucune session : acces premium refuse");
            return false;
        }
    };

    let premium = match fetch(&token).await {
        Ok(p) => p,
        Err(FetchError::Unauthorized) => {
            // L'acces a expire. On le renouvelle depuis le jeton conserve et on
            // retente une fois, sans quoi le serveur resterait bloque jusqu'a la
            // prochaine ouverture de l'application.
            tracing::info!("[ENTITLEMENT] Acces expire, renouvellement");
            if let Ok(mut s) = SESSION.write() {
                *s = None;
            }
            match refresh_access_token(true).await {
                Ok(fresh) => match fetch(&fresh).await {
                    Ok(p) => p,
                    Err(e) => {
                        tracing::warn!("[ENTITLEMENT] Verification impossible apres renouvellement ({}) : acces refuse", e);
                        false
                    }
                },
                Err(e) => {
                    tracing::warn!("[ENTITLEMENT] Renouvellement apres 401 impossible ({}) : acces refuse", e);
                    false
                }
            }
        }
        Err(e) => {
            tracing::warn!("[ENTITLEMENT] Verification impossible ({}) : acces premium refuse", e);
            false
        }
    };

    if let Ok(mut guard) = VERDICT.write() {
        *guard = Some(Verdict {
            premium,
            checked_at: Instant::now(),
        });
    }
    premium
}

/// Distingue l'acces expire des autres echecs : lui seul justifie un
/// renouvellement puis une seconde tentative.
enum FetchError {
    Unauthorized,
    Other(String),
}

impl std::fmt::Display for FetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FetchError::Unauthorized => write!(f, "acces refuse par Supabase"),
            FetchError::Other(e) => write!(f, "{}", e),
        }
    }
}

/// Interroge Supabase avec le jeton de l'utilisateur. La RLS ne lui renvoie que
/// sa propre ligne, il n'y a donc pas d'identifiant a passer.
async fn fetch(access_token: &str) -> Result<bool, FetchError> {
    if SUPABASE_URL.is_empty() || SUPABASE_ANON_KEY.is_empty() {
        return Err(FetchError::Other(
            "configuration Supabase absente du binaire".to_string(),
        ));
    }

    let url = format!(
        "{}/rest/v1/profiles?select=is_premium",
        SUPABASE_URL.trim_end_matches('/')
    );

    let resp = reqwest::Client::new()
        .get(&url)
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Accept", "application/json")
        .timeout(HTTP_TIMEOUT)
        .send()
        .await
        .map_err(|e| FetchError::Other(e.to_string()))?;

    let status = resp.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err(FetchError::Unauthorized);
    }
    if !status.is_success() {
        return Err(FetchError::Other(format!("Supabase a repondu {}", status)));
    }

    let rows: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| FetchError::Other(e.to_string()))?;

    Ok(rows
        .get(0)
        .and_then(|row| row.get("is_premium"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false))
}

#[cfg(test)]
mod session_tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

    fn jwt_with_exp(exp: i64) -> String {
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none","typ":"JWT"}"#);
        let payload = URL_SAFE_NO_PAD.encode(format!(r#"{{"exp":{}}}"#, exp));
        format!("{}.{}.sig", header, payload)
    }

    #[test]
    fn jwt_exp_lit_la_date() {
        assert_eq!(jwt_exp_unix(&jwt_with_exp(1_700_000_000)), Some(1_700_000_000));
        assert_eq!(jwt_exp_unix("not-a-jwt"), None);
        assert_eq!(jwt_exp_unix(""), None);
    }

    #[test]
    fn access_valable_tant_que_exp_est_dans_le_futur() {
        let token = jwt_with_exp(2_000);
        assert!(access_token_usable(&token, None, 1_000, 30));
        assert!(!access_token_usable(&token, None, 1_980, 30));
        assert!(access_token_usable("opaque", Some(2_000), 1_000, 30));
        assert!(!access_token_usable("", Some(2_000), 1_000, 30));
        // Sans date : on ne force pas un refresh (evite de revoquer l'UI au boot).
        assert!(access_token_usable("opaque-no-exp", None, 1_000, 30));
    }

    #[test]
    fn apply_token_response_conserve_l_utilisateur() {
        let existing = json!({
            "refresh_token": "old-rt",
            "access_token": "old-at",
            "user": { "id": "abc", "email": "a@b.c" }
        });
        let body = json!({
            "access_token": "new-at",
            "refresh_token": "new-rt",
            "expires_in": 3600,
            "token_type": "bearer"
        });
        let merged = apply_token_response(Some(existing), &body).unwrap();
        assert_eq!(merged["access_token"], "new-at");
        assert_eq!(merged["refresh_token"], "new-rt");
        assert_eq!(merged["user"]["id"], "abc");
        assert!(merged["expires_at"].as_i64().unwrap() > 0);
        assert_eq!(merged["expires_in"], 3600);
    }

    #[test]
    fn apply_token_response_legacy_refresh_seul() {
        let existing = json!({ "refresh_token": "only-rt" });
        let body = json!({
            "access_token": "at",
            "refresh_token": "rt2"
        });
        let merged = apply_token_response(Some(existing), &body).unwrap();
        assert_eq!(access_token_from_value(&merged).as_deref(), Some("at"));
        assert_eq!(refresh_token_from_value(&merged).as_deref(), Some("rt2"));
    }

    #[test]
    fn apply_token_response_refuse_sans_acces() {
        let body = json!({ "refresh_token": "rt" });
        assert!(apply_token_response(None, &body).is_err());
    }

    #[test]
    fn sidecar_ne_doit_pas_tourner_un_acces_encore_valable() {
        // Regression : au boot le sidecar renouvelait systematiquement, ce qui
        // invalidait le refresh encore stocke dans la webview.
        let token = jwt_with_exp(now_unix() + 3_600);
        assert!(
            access_token_usable(&token, None, now_unix(), EXPIRY_SKEW_SECS),
            "un JWT d'une heure ne doit pas declencher de refresh au demarrage"
        );
    }
}
