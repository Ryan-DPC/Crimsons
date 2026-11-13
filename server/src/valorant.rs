//! Valorant info-only integration (MVP stub).
//!
//! Fetches competitive rank + recent matches via Riot cloud API when
//! `RIOT_API_KEY` is set; otherwise serves deterministic mock data for Hub /
//! StreamDock development. No client control (Vanguard).

use crate::events::WsSender;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

const RIOT_ACCOUNT_BASE: &str = "https://europe.api.riotgames.com";
const VAL_REGION_BASE: &str = "https://eu.api.riotgames.com";

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
pub struct ValorantRank {
    pub tier: String,
    pub rr: i32,
    #[serde(default)]
    pub episode: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
pub struct ValorantMatch {
    pub match_id: String,
    pub won: bool,
    pub kills: u32,
    pub deaths: u32,
    pub assists: u32,
    pub agent: String,
    #[serde(default)]
    pub map: String,
    #[serde(default)]
    pub mode: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct ValorantState {
    pub connected: bool,
    /// True when serving mock / fallback data (no key or API failure).
    pub mock: bool,
    pub rank: ValorantRank,
    pub matches: Vec<ValorantMatch>,
    /// Index into `matches` for StreamDock last-match scroll (0 = most recent).
    pub match_index: usize,
    pub error: Option<String>,
    #[serde(default)]
    pub riot_name: Option<String>,
}

impl ValorantState {
    pub fn current_match(&self) -> Option<&ValorantMatch> {
        self.matches.get(self.match_index)
    }
}

/// Clamp / wrap match scroll index. Pure helper for unit tests + commands.
pub fn scroll_match_index(len: usize, current: usize, delta: i32) -> usize {
    if len == 0 {
        return 0;
    }
    let cur = current.min(len - 1) as i32;
    let next = cur + delta;
    if next < 0 {
        0
    } else if next as usize >= len {
        len - 1
    } else {
        next as usize
    }
}

pub fn mock_state() -> ValorantState {
    fn m(
        id: &str,
        won: bool,
        k: u32,
        d: u32,
        a: u32,
        agent: &str,
        map: &str,
    ) -> ValorantMatch {
        ValorantMatch {
            match_id: id.into(),
            won,
            kills: k,
            deaths: d,
            assists: a,
            agent: agent.into(),
            map: map.into(),
            mode: "Competitive".into(),
        }
    }
    ValorantState {
        connected: true,
        mock: true,
        rank: ValorantRank {
            tier: "Diamond 2".into(),
            rr: 64,
            episode: "E9A3".into(),
        },
        matches: vec![
            m("mock-1", true, 18, 12, 4, "Jett", "Ascent"),
            m("mock-2", false, 11, 16, 7, "Sage", "Bind"),
            m("mock-3", true, 22, 14, 3, "Reyna", "Haven"),
            m("mock-4", false, 9, 15, 5, "Omen", "Lotus"),
            m("mock-5", true, 15, 13, 8, "Killjoy", "Split"),
        ],
        match_index: 0,
        error: None,
        riot_name: Some("MockPlayer#CRIM".into()),
    }
}

/// Best-effort parse of a Riot MMR / competitive update JSON blob into rank.
/// Accepts a few common shapes used by unofficial + Riot endpoints.
pub fn parse_rank_from_json(value: &serde_json::Value) -> Option<ValorantRank> {
    // CompetitiveUpdates-style: { "CurrentTier": 20, "RankedRating": 64, ... }
    if let (Some(tier_num), Some(rr)) = (
        value.get("CurrentTier").and_then(|v| v.as_i64()),
        value
            .get("RankedRating")
            .or_else(|| value.get("rankedRating"))
            .and_then(|v| v.as_i64()),
    ) {
        return Some(ValorantRank {
            tier: tier_name_from_id(tier_num as i32),
            rr: rr as i32,
            episode: value
                .get("SeasonID")
                .or_else(|| value.get("seasonId"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        });
    }
    // Explicit string tier
    if let Some(tier) = value
        .get("tier")
        .or_else(|| value.get("currentTierPatched"))
        .and_then(|v| v.as_str())
    {
        let rr = value
            .get("rr")
            .or_else(|| value.get("ranking_in_tier"))
            .or_else(|| value.get("rankedRating"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32;
        return Some(ValorantRank {
            tier: tier.to_string(),
            rr,
            episode: value
                .get("episode")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        });
    }
    None
}

fn tier_name_from_id(id: i32) -> String {
    // Simplified official competitive ladder mapping (info display only).
    let names = [
        "Unranked",
        "Iron 1",
        "Iron 2",
        "Iron 3",
        "Bronze 1",
        "Bronze 2",
        "Bronze 3",
        "Silver 1",
        "Silver 2",
        "Silver 3",
        "Gold 1",
        "Gold 2",
        "Gold 3",
        "Platinum 1",
        "Platinum 2",
        "Platinum 3",
        "Diamond 1",
        "Diamond 2",
        "Diamond 3",
        "Ascendant 1",
        "Ascendant 2",
        "Ascendant 3",
        "Immortal 1",
        "Immortal 2",
        "Immortal 3",
        "Radiant",
    ];
    if id >= 0 && (id as usize) < names.len() {
        names[id as usize].to_string()
    } else {
        format!("Tier {}", id)
    }
}

pub struct ValorantService {
    state: Arc<RwLock<ValorantState>>,
    sender: WsSender,
    pub is_enabled: Arc<AtomicBool>,
}

impl ValorantService {
    pub fn new(sender: WsSender) -> Self {
        Self {
            state: Arc::new(RwLock::new(mock_state())),
            sender,
            is_enabled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub async fn snapshot(&self) -> ValorantState {
        self.state.read().await.clone()
    }

    async fn broadcast(&self) {
        let data = self.state.read().await.clone();
        let _ = self
            .sender
            .0
            .send(serde_json::json!({ "type": "VALORANT_STATE", "data": data }).to_string());
    }

    pub async fn handle_command(
        &self,
        endpoint: &str,
        _params: Option<serde_json::Value>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if !self.is_enabled.load(Ordering::Relaxed) {
            tracing::info!("[VALORANT] Command '{}' ignored: service disabled", endpoint);
            return Ok(());
        }
        match endpoint {
            "refresh" => {
                self.refresh().await;
            }
            "match_next" => {
                let mut st = self.state.write().await;
                st.match_index = scroll_match_index(st.matches.len(), st.match_index, -1);
                drop(st);
                self.broadcast().await;
            }
            "match_prev" => {
                let mut st = self.state.write().await;
                st.match_index = scroll_match_index(st.matches.len(), st.match_index, 1);
                drop(st);
                self.broadcast().await;
            }
            other => {
                tracing::warn!("[VALORANT] Unknown endpoint '{}'", other);
            }
        }
        Ok(())
    }

    pub async fn refresh(&self) {
        let next = fetch_or_mock().await;
        {
            let mut st = self.state.write().await;
            let keep_index = st.match_index.min(next.matches.len().saturating_sub(1));
            *st = next;
            st.match_index = keep_index;
        }
        self.broadcast().await;
    }

    pub async fn start_background_polling(&self) {
        let enabled = self.is_enabled.clone();
        let this_state = self.state.clone();
        let sender = self.sender.clone();
        tokio::spawn(async move {
            // Initial mock so Hub/plugin have something before first refresh.
            {
                let data = this_state.read().await.clone();
                let _ = sender
                    .0
                    .send(serde_json::json!({ "type": "VALORANT_STATE", "data": data }).to_string());
            }
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
                if !enabled.load(Ordering::Relaxed) {
                    continue;
                }
                let next = fetch_or_mock().await;
                {
                    let mut st = this_state.write().await;
                    let keep_index = st.match_index.min(next.matches.len().saturating_sub(1));
                    *st = next;
                    st.match_index = keep_index;
                }
                let data = this_state.read().await.clone();
                let _ = sender
                    .0
                    .send(serde_json::json!({ "type": "VALORANT_STATE", "data": data }).to_string());
            }
        });
    }
}

async fn fetch_or_mock() -> ValorantState {
    match std::env::var("RIOT_API_KEY") {
        Ok(key) if !key.trim().is_empty() => match fetch_riot(&key).await {
            Ok(st) => st,
            Err(e) => {
                tracing::warn!("[VALORANT] Riot fetch failed ({}), using mock", e);
                let mut m = mock_state();
                m.error = Some(format!("riot_fetch_failed: {}", e));
                m
            }
        },
        _ => {
            tracing::info!("[VALORANT] No RIOT_API_KEY — mock state");
            mock_state()
        }
    }
}

/// Minimal Riot cloud probe. Full RSO + puuid wiring is out of MVP scope:
/// without `RIOT_PUUID` / `RIOT_GAME_NAME`+`RIOT_TAG_LINE` we still fall back to mock.
async fn fetch_riot(api_key: &str) -> Result<ValorantState, String> {
    let agent = ureq::agent();
    let puuid = resolve_puuid(&agent, api_key)?;

    // Competitive updates (recent matches + RR). Endpoint may 403 without product access —
    // caller falls back to mock.
    let url = format!(
        "{}/val/match/v1/competitive-updates/by-puuid/{}?startIndex=0&endIndex=5&queue=competitive",
        VAL_REGION_BASE, puuid
    );
    let resp = agent
        .get(&url)
        .set("X-Riot-Token", api_key)
        .call()
        .map_err(|e| format!("competitive-updates: {}", e))?;
    let body: serde_json::Value = resp
        .into_json()
        .map_err(|e| format!("json: {}", e))?;

    let mut matches = Vec::new();
    if let Some(arr) = body.get("Matches").or_else(|| body.get("matches")).and_then(|v| v.as_array()) {
        for (i, m) in arr.iter().take(10).enumerate() {
            let tier = m.get("TierAfterUpdate").and_then(|v| v.as_i64()).unwrap_or(0);
            matches.push(ValorantMatch {
                match_id: m
                    .get("MatchID")
                    .or_else(|| m.get("matchId"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(&format!("riot-{}", i))
                    .to_string(),
                won: m
                    .get("RankedRatingEarned")
                    .and_then(|v| v.as_i64())
                    .map(|v| v >= 0)
                    .unwrap_or(false),
                kills: 0,
                deaths: 0,
                assists: 0,
                agent: "—".into(),
                map: String::new(),
                mode: "Competitive".into(),
            });
            let _ = tier; // reserved for richer parse later
        }
    }

    let rank = body
        .get("Matches")
        .or_else(|| body.get("matches"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(parse_rank_from_json)
        .unwrap_or(ValorantRank {
            tier: "Unranked".into(),
            rr: 0,
            episode: String::new(),
        });

    // Account base kept for future name resolve (unused when PUUID provided).
    let _ = RIOT_ACCOUNT_BASE;

    Ok(ValorantState {
        connected: true,
        mock: false,
        rank,
        matches: if matches.is_empty() {
            mock_state().matches
        } else {
            matches
        },
        match_index: 0,
        error: None,
        riot_name: std::env::var("RIOT_GAME_NAME").ok().map(|n| {
            let tag = std::env::var("RIOT_TAG_LINE").unwrap_or_else(|_| "EUW".into());
            format!("{}#{}", n, tag)
        }),
    })
}

fn resolve_puuid(agent: &ureq::Agent, api_key: &str) -> Result<String, String> {
    if let Ok(p) = std::env::var("RIOT_PUUID") {
        if !p.trim().is_empty() {
            return Ok(p);
        }
    }
    let name = std::env::var("RIOT_GAME_NAME").map_err(|_| "RIOT_PUUID or RIOT_GAME_NAME required".to_string())?;
    let tag = std::env::var("RIOT_TAG_LINE").unwrap_or_else(|_| "EUW".to_string());
    let url = format!(
        "{}/riot/account/v1/accounts/by-riot-id/{}/{}",
        RIOT_ACCOUNT_BASE,
        urlencoding::encode(&name),
        urlencoding::encode(&tag)
    );
    let resp = agent
        .get(&url)
        .set("X-Riot-Token", api_key)
        .call()
        .map_err(|e| format!("account lookup: {}", e))?;
    let body: serde_json::Value = resp.into_json().map_err(|e| format!("json: {}", e))?;
    body.get("puuid")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "account response missing puuid".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scroll_clamps_at_edges() {
        assert_eq!(scroll_match_index(0, 0, 1), 0);
        assert_eq!(scroll_match_index(5, 0, -1), 0);
        assert_eq!(scroll_match_index(5, 4, 1), 4);
        assert_eq!(scroll_match_index(5, 2, 1), 3);
        assert_eq!(scroll_match_index(5, 2, -1), 1);
    }

    #[test]
    fn mock_state_has_rank_and_matches() {
        let st = mock_state();
        assert!(st.mock);
        assert!(!st.rank.tier.is_empty());
        assert_eq!(st.matches.len(), 5);
        assert_eq!(st.current_match().unwrap().match_id, "mock-1");
    }

    #[test]
    fn parse_rank_from_competitive_update() {
        let v = serde_json::json!({
            "CurrentTier": 17,
            "RankedRating": 64,
            "SeasonID": "E9A3"
        });
        let r = parse_rank_from_json(&v).expect("rank");
        assert_eq!(r.tier, "Diamond 2");
        assert_eq!(r.rr, 64);
        assert_eq!(r.episode, "E9A3");
    }

    #[test]
    fn parse_rank_from_string_tier() {
        let v = serde_json::json!({ "tier": "Immortal 1", "rr": 12 });
        let r = parse_rank_from_json(&v).unwrap();
        assert_eq!(r.tier, "Immortal 1");
        assert_eq!(r.rr, 12);
    }
}
