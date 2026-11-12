//! Billing Stripe — helpers partagés avec les Edge Functions Supabase.
//!
//! Le sidecar **ne reçoit pas** les webhooks Stripe (localhost). Les endpoints
//! `create-checkout-session`, `create-portal-session` et `stripe-webhook`
//! vivent dans `supabase/functions/`. Ce module documente le mapping
//! price → Premium et permet de vérifier une signature webhook en tests / outils.
//!
//! Feature flag : `PAYMENTS_ENABLED` (défaut false). Live : `STRIPE_LIVE_ENABLED`.

use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PremiumPlan {
    Monthly,
    Yearly,
}

impl PremiumPlan {
    pub fn as_str(self) -> &'static str {
        match self {
            PremiumPlan::Monthly => "premium_monthly",
            PremiumPlan::Yearly => "premium_yearly",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "premium_monthly" | "monthly" | "month" => Some(PremiumPlan::Monthly),
            "premium_yearly" | "yearly" | "year" | "annual" => Some(PremiumPlan::Yearly),
            _ => None,
        }
    }
}

/// True si les paiements sont exposés (Edge Functions + futur CTA UI).
pub fn payments_enabled() -> bool {
    parse_bool_env("PAYMENTS_ENABLED", false)
}

pub fn stripe_live_enabled() -> bool {
    parse_bool_env("STRIPE_LIVE_ENABLED", false)
}

fn parse_bool_env(key: &str, default: bool) -> bool {
    match std::env::var(key) {
        Ok(v) => {
            let t = v.trim().to_ascii_lowercase();
            t == "1" || t == "true" || t == "yes" || t == "on"
        }
        Err(_) => default,
    }
}

/// Refuse une clé live tant que `STRIPE_LIVE_ENABLED` n'est pas true.
pub fn assert_stripe_mode_allowed(secret_key: &str, live_enabled: bool) -> Result<(), String> {
    if secret_key.is_empty() {
        return Err("STRIPE_SECRET_KEY manquant".into());
    }
    let is_live = secret_key.starts_with("sk_live_");
    let is_test = secret_key.starts_with("sk_test_");
    if is_live && !live_enabled {
        return Err(
            "Clé Stripe live refusée : STRIPE_LIVE_ENABLED=true requis après validation CH".into(),
        );
    }
    if !is_live && !is_test {
        return Err("STRIPE_SECRET_KEY invalide (sk_test_… ou sk_live_…)".into());
    }
    Ok(())
}

pub fn plan_from_price_id(
    price_id: &str,
    monthly_price: &str,
    yearly_price: &str,
) -> Option<PremiumPlan> {
    if price_id.is_empty() {
        return None;
    }
    if !monthly_price.is_empty() && price_id == monthly_price {
        return Some(PremiumPlan::Monthly);
    }
    if !yearly_price.is_empty() && price_id == yearly_price {
        return Some(PremiumPlan::Yearly);
    }
    None
}

pub fn is_premium_granting_status(status: &str) -> bool {
    status == "active" || status == "trialing"
}

/// Parse l'en-tête `Stripe-Signature` (`t=…,v1=…`).
pub fn parse_stripe_signature_header(header: &str) -> Option<(i64, Vec<String>)> {
    let mut timestamp: Option<i64> = None;
    let mut signatures: Vec<String> = Vec::new();
    for part in header.split(',') {
        let part = part.trim();
        if let Some(t) = part.strip_prefix("t=") {
            timestamp = t.parse().ok();
        } else if let Some(v) = part.strip_prefix("v1=") {
            signatures.push(v.to_string());
        }
    }
    let t = timestamp?;
    if signatures.is_empty() {
        return None;
    }
    Some((t, signatures))
}

/// Vérifie une signature Stripe webhook (HMAC-SHA256 hex de `timestamp.payload`).
///
/// Note : les secrets Stripe `whsec_…` sont en pratique décodés en base64 par le
/// SDK officiel. Ici, pour les **tests unitaires** et le mock, on HMAC le secret
/// tel quel (UTF-8). Pour une vérif production, utiliser le SDK Stripe (Edge Function).
pub fn verify_stripe_webhook_signature_raw(
    payload: &str,
    header: &str,
    secret: &str,
    tolerance_secs: i64,
    now_unix: i64,
) -> Result<(), String> {
    let (timestamp, signatures) = parse_stripe_signature_header(header)
        .ok_or_else(|| "en-tête Stripe-Signature invalide".to_string())?;
    if (now_unix - timestamp).abs() > tolerance_secs {
        return Err("timestamp webhook hors tolérance".into());
    }
    let signed = format!("{}.{}", timestamp, payload);
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).map_err(|e| format!("hmac key: {e}"))?;
    mac.update(signed.as_bytes());
    let expected = hex::encode(mac.finalize().into_bytes());
    if signatures.iter().any(|s| s.eq_ignore_ascii_case(&expected)) {
        Ok(())
    } else {
        Err("signature webhook invalide".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_plan_aliases() {
        assert_eq!(PremiumPlan::parse("monthly"), Some(PremiumPlan::Monthly));
        assert_eq!(PremiumPlan::parse("YEARLY"), Some(PremiumPlan::Yearly));
        assert_eq!(PremiumPlan::parse("nope"), None);
    }

    #[test]
    fn price_maps_to_premium_plan() {
        assert_eq!(
            plan_from_price_id("price_m", "price_m", "price_y"),
            Some(PremiumPlan::Monthly)
        );
        assert_eq!(
            plan_from_price_id("price_y", "price_m", "price_y"),
            Some(PremiumPlan::Yearly)
        );
        assert_eq!(plan_from_price_id("price_x", "price_m", "price_y"), None);
        assert_eq!(plan_from_price_id("", "price_m", "price_y"), None);
    }

    #[test]
    fn live_key_gated() {
        assert!(assert_stripe_mode_allowed("sk_test_abc", false).is_ok());
        assert!(assert_stripe_mode_allowed("sk_live_abc", false).is_err());
        assert!(assert_stripe_mode_allowed("sk_live_abc", true).is_ok());
        assert!(assert_stripe_mode_allowed("rk_test", false).is_err());
    }

    #[test]
    fn premium_status_mapping() {
        assert!(is_premium_granting_status("active"));
        assert!(is_premium_granting_status("trialing"));
        assert!(!is_premium_granting_status("canceled"));
        assert!(!is_premium_granting_status("past_due"));
    }

    #[test]
    fn webhook_signature_mock_roundtrip() {
        let secret = "whsec_test_secret";
        let payload = r#"{"id":"evt_1","type":"checkout.session.completed"}"#;
        let ts = 1_700_000_000_i64;
        let signed = format!("{}.{}", ts, payload);
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(signed.as_bytes());
        let sig = hex::encode(mac.finalize().into_bytes());
        let header = format!("t={},v1={}", ts, sig);

        assert!(verify_stripe_webhook_signature_raw(payload, &header, secret, 300, ts).is_ok());
        assert!(
            verify_stripe_webhook_signature_raw(payload, &header, "wrong", 300, ts).is_err()
        );
        assert!(
            verify_stripe_webhook_signature_raw(payload, &header, secret, 10, ts + 100).is_err()
        );
    }

    #[test]
    fn payments_disabled_by_default() {
        // Ne pas polluer l'env process : on teste la sémantique du parseur.
        assert!(!parse_bool_env("__CRIMSON_MISSING_PAYMENTS_FLAG__", false));
        std::env::set_var("__CRIMSON_TMP_PAYMENTS_FLAG__", "true");
        assert!(parse_bool_env("__CRIMSON_TMP_PAYMENTS_FLAG__", false));
        std::env::remove_var("__CRIMSON_TMP_PAYMENTS_FLAG__");
    }
}
