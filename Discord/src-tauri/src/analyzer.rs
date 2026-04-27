use tauri::AppHandle;
use reqwest::Client;
use serde_json::{json, Value};
use regex::Regex;
use crate::storage;

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct RuneBuild {
    pub name: String,
    pub winrate: String,
    pub banrate: String,
    #[serde(rename = "primaryStyleId")]
    pub primary_style_id: u32,
    #[serde(rename = "subStyleId")]
    pub sub_style_id: u32,
    #[serde(rename = "perkIds")]
    pub perk_ids: Vec<u32>,
    pub shards: Vec<u32>,
    pub spells: Vec<u32>,
}

#[tauri::command]
pub async fn fetch_dynamic_runes(app: AppHandle, champion_name: String, role: String) -> Result<Vec<RuneBuild>, String> {
    let mut builds = Vec::new();

    // Map French/LCU role to OP.GG path
    let opgg_role = match role.to_lowercase().as_str() {
        "haut" | "top" => "top",
        "jungle" => "jungle",
        "milieu" | "middle" | "mid" => "mid",
        "bas" | "bottom" | "adc" => "adc",
        "support" | "utility" => "support",
        _ => ""
    };

    // 1. Scrape OP.GG for standard build
    match scrape_opgg(&champion_name, opgg_role).await {
        Ok(opgg_builds) => {
            builds.extend(opgg_builds);
        }
        Err(e) => {
            println!("OP.GG Scraping Error for {} ({}): {}", champion_name, opgg_role, e);
        }
    }

    // 2. Fetch Gemini builds
    let data = storage::load_data(&app);
    let key = data.gemini_api_key.unwrap_or_default();
    
    if !key.is_empty() {
        match fetch_gemini(&key, &champion_name, &role).await {
            Ok(mut gemini_builds) => {
                builds.append(&mut gemini_builds);
            }
            Err(e) => {
                println!("Gemini API Error for {}: {}", champion_name, e);
            }
        }
    }

    // 3. Fallback Stubs (Always add if we have nothing, or as extra options)
    if builds.is_empty() {
        println!("All fetchers failed or returned empty results. Adding emergency stubs.");
        builds.push(RuneBuild {
            name: "Build de Secours (Standard)".into(),
            winrate: "N/A".into(), banrate: "N/A".into(),
            primary_style_id: 8000, sub_style_id: 8400,
            perk_ids: vec![8021, 8009, 9103, 8014, 8473, 8451],
            shards: vec![5005, 5008, 5001],
            spells: vec![4, 3]
        });
    }

    Ok(builds)
}

async fn scrape_opgg(champion: &str, role: &str) -> Result<Vec<RuneBuild>, String> {
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let champ_slug = champion.to_lowercase().replace(" ", "").replace("'", "").replace(".", "");
    let url = if role.is_empty() {
        format!("https://www.op.gg/champions/{}/build", champ_slug)
    } else {
        format!("https://www.op.gg/champions/{}/{}/build", champ_slug, role)
    };

    let res = client.get(&url).send().await.map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;

    let mut found_builds = Vec::new();
    
    // Improved extraction for Next.js (More resilient to escaping variations)
    // We look for importClientData followed by its JSON object
    let re = Regex::new(r#"importClientData(?:\\"|"):(\{.*?\})"#).unwrap();
    
    for caps in re.captures_iter(&res) {
        let mut json_str = caps[1].to_string();
        
        // Handle double escaped quotes in Next.js stream
        if json_str.contains("\\\"") {
            json_str = json_str.replace("\\\"", "\"");
        }
        
        // Sometimes the capture group might be cut off if it's too long in a single push
        // or contain extra trailing characters. Greedy matching should be careful.
        // Let's try to parse what we have.
        if let Ok(data) = serde_json::from_str::<Value>(&json_str) {
            let primary_style_id = data["primaryStyleId"].as_u64().unwrap_or(0) as u32;
            let sub_style_id = data["subStyleId"].as_u64().unwrap_or(0) as u32;
            
            if primary_style_id == 0 { continue; }

            let mut perk_ids = Vec::new();
            if let Some(p) = data["selectedPerkIds"].as_array() {
                for id in p {
                    perk_ids.push(id.as_u64().unwrap_or(0) as u32);
                }
            }

            if perk_ids.len() < 6 { continue; }

            let mut final_perks = Vec::new();
            let mut final_shards = Vec::new();
            
            if perk_ids.len() >= 9 {
                final_perks = perk_ids[0..6].to_vec();
                final_shards = perk_ids[6..9].to_vec();
            } else {
                final_perks = perk_ids.clone();
                final_shards = vec![5008, 5008, 5001];
            }

            let build_name = format!("Pro Build OP.GG #{}", found_builds.len() + 1);
            let build = RuneBuild {
                name: build_name,
                winrate: "52%+".into(),
                banrate: "--".into(),
                primary_style_id,
                sub_style_id,
                perk_ids: final_perks,
                shards: final_shards,
                spells: vec![4, 12],
            };
            
            if !found_builds.iter().any(|b: &RuneBuild| b.perk_ids == build.perk_ids) {
                found_builds.push(build);
            }
        }
        
        if found_builds.len() >= 2 { break; }
    }

    if !found_builds.is_empty() {
        return Ok(found_builds);
    }

    Err(format!("Could not find valid rune data in OP.GG page for {}", champion))
}


async fn fetch_gemini(api_key: &str, champion: &str, role: &str) -> Result<Vec<RuneBuild>, String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={}", api_key);
    
    // We request JSON directly.
    let prompt = format!(
        "You are an expert League of Legends analytics bot. We need 2 rune builds for {champion} in the {role} position. \
        The first one must be 'Anti-Comp' (against tank-heavy or assassin-heavy combos). \
        The second one must be 'Late Game' (scaling focused). \
        Both must be highly viable and realistic for {champion}. \
        IMPORTANT: Use numerical IDs for primaryStyleId (e.g. 8100, 8000), subStyleId, perkIds (exactly 6 IDs, 4 primary and 2 secondary), \
        shards (exactly 3 IDs, 5008, 5005, 5002 etc) and spells (exactly 2 IDs, like 4 for Flash, 14 for Ignite, 11 for Smite). \
        Return EXCLUSIVELY a JSON array of 2 items matching this exact structure: \
        [{{ \"name\": \"Contre-Compo\", \"winrate\": \"55.0%\", \"banrate\": \"--\", \"primaryStyleId\": 8000, \"subStyleId\": 8400, \"perkIds\": [8021,8009,9103,8014,8473,8451], \"shards\": [5005,5008,5001], \"spells\": [4, 14] }}, \
         {{ \"name\": \"Late Game Scaling\", ... }}]",
         champion=champion, role=role
    );

    let body = json!({
        "contents": [{
            "parts": [{"text": prompt}]
        }],
        "generationConfig": {
            "responseMimeType": "application/json"
        }
    });

    let res = client.post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send().await.map_err(|e| e.to_string())?
        .text().await.map_err(|e| e.to_string())?;

    let root: Value = serde_json::from_str(&res).map_err(|e| format!("Gemini Parse Error: {}", e))?;
    let text = root["candidates"][0]["content"]["parts"][0]["text"].as_str().ok_or("No text in gemini response")?;

    let builds: Vec<RuneBuild> = serde_json::from_str(text).map_err(|e| format!("Gemini JSON Model Error: {}", e))?;
    
    Ok(builds)
}
