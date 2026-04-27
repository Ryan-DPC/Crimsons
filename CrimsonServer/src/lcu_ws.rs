use crate::{lcu, storage, automation};
use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::{tungstenite::protocol::Message};
use serde_json::{json, Value};
use crate::events::WsSender;
use std::time::Duration;
use tokio::time::sleep;
use base64::{Engine as _, engine::general_purpose};
use rustls::client::danger::{ServerCertVerifier, ServerCertVerified};
use std::sync::Arc;
use std::fmt::Debug;

pub async fn start_lcu_ws(sender: WsSender) {
    loop {
        let info = match lcu::get_lcu_info() {
            Ok(i) => i,
            Err(_) => {
                sleep(Duration::from_secs(3)).await;
                continue;
            }
        };

        let url_full = format!("wss://127.0.0.1:{}/", info.port);
        let auth = general_purpose::STANDARD.encode(format!("riot:{}", info.password));
        
        // Custom request to include Authorization header
        let request = http::Request::builder()
            .uri(&url_full)
            .header("Authorization", format!("Basic {}", auth))
            .header("Host", "127.0.0.1")
            .header("Connection", "Upgrade")
            .header("Upgrade", "websocket")
            .header("Sec-WebSocket-Version", "13")
            .header("Sec-WebSocket-Key", tokio_tungstenite::tungstenite::handshake::client::generate_key())
            .body(())
            .unwrap();

        match connect_async_danger_tls(request).await {
            Ok((mut ws_stream, _)) => {
                println!("Connected to LCU WebSocket");
                
                // Subscribe to all events
                let subscribe_msg = json!([5, "OnJsonApiEvent"]).to_string();
                let _ = ws_stream.send(Message::Text(subscribe_msg.into())).await;

                let sender_clone = WsSender(sender.0.clone());

                while let Some(msg) = ws_stream.next().await {
                    match msg {
                        Ok(Message::Text(text)) => {
                            if let Ok(value) = serde_json::from_str::<Value>(&text) {
                                // LCU WAMP format: [8, "OnJsonApiEvent", { data: ..., uri: ..., eventType: ... }]
                                if let Some(arr) = value.as_array() {
                                    if arr.len() >= 3 && arr[0] == 8 {
                                        let event = &arr[2];
                                        let uri = event["uri"].as_str().unwrap_or("");
                                        let data = &event["data"];

                                        match uri {
                                            "/lol-gameflow/v1/gameflow-phase" => {
                                                let phase = data.as_str().unwrap_or("None");
                                                let _ = sender_clone.0.send(json!({"type": "GAME_PHASE", "phase": phase}).to_string());
                                                
                                                if phase == "ChampSelect" {
                                                    let app_data = storage::load_data_from_path(storage::get_data_path_from_env());
                                                    if let Some(invisible) = app_data.other.get("invisibleAutomation").and_then(|v| v.as_bool()) {
                                                        if !invisible {
                                                            let _ = sender_clone.0.send(json!({"type": "REQUEST_UI_SHOW"}).to_string());
                                                        }
                                                    }
                                                }
                                            },
                                            "/lol-champ-select/v1/session" => {
                                                // Simplified broadcast
                                                let _ = sender_clone.0.send(json!({"type": "CHAMP_SELECT_UPDATE", "data": data}).to_string());
                                                
                                                // Trigger Automation
                                                let auto_data = data.clone();
                                                automation::handle_champ_select_standalone(&auto_data);
                                            },
                                            "/lol-matchmaking/v1/ready-check" => {
                                                automation::handle_ready_check(data);
                                            },
                                            _ => {}
                                        }
                                    }
                                }
                            }
                        },
                        Ok(Message::Close(_)) | Err(_) => break,
                        _ => {}
                    }
                }
            },
            Err(e) => {
                println!("Failed to connect to LCU WebSocket: {}", e);
                sleep(Duration::from_secs(5)).await;
            }
        }
    }
}

#[derive(Debug)]
struct NoCertificateVerification;

impl ServerCertVerifier for NoCertificateVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        vec![
            rustls::SignatureScheme::RSA_PSS_SHA256,
            rustls::SignatureScheme::ED25519,
            rustls::SignatureScheme::ECDSA_NISTP256_SHA256,
        ]
    }
}

async fn connect_async_danger_tls(
    request: http::Request<()>,
) -> Result<
    (
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        http::Response<Option<Vec<u8>>>,
    ),
    tokio_tungstenite::tungstenite::Error,
> {
    let config = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(NoCertificateVerification))
        .with_no_client_auth();

    let connector = tokio_tungstenite::Connector::Rustls(Arc::new(config));
    tokio_tungstenite::connect_async_tls_with_config(request, None, false, Some(connector)).await
}


