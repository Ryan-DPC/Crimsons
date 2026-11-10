package hub

import (
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Ryan-DPC/Crimsons/server-go/internal/auth"
	"github.com/Ryan-DPC/Crimsons/server-go/internal/storage"
	"github.com/Ryan-DPC/Crimsons/server-go/internal/version"
	"github.com/gorilla/websocket"
)

// Server is the local Crimsons sidecar (WS + a few HTTP endpoints on :40510).
type Server struct {
	Port uint16

	LolEnabled       atomic.Bool
	AutoAcceptEnabled atomic.Bool
	SpotifyEnabled   atomic.Bool
	DiscordEnabled   atomic.Bool
	LolConnected     atomic.Bool
	DiscordConnected atomic.Bool

	upgrader websocket.Upgrader

	clientsMu sync.RWMutex
	clients   map[*client]struct{}
}

type client struct {
	conn *websocket.Conn
	send chan []byte
}

func New(port uint16) *Server {
	s := &Server{
		Port:    port,
		clients: make(map[*client]struct{}),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				origin := r.Header.Get("Origin")
				if origin == "" {
					return true // native / StreamDock
				}
				return IsLocalOrigin(origin)
			},
		},
	}
	data := storage.Load()
	s.AutoAcceptEnabled.Store(data.AutoAccept)
	plugins := storage.PluginsMap(data)
	s.LolEnabled.Store(pluginBool(plugins, "leagueOfLegends", true))
	s.SpotifyEnabled.Store(pluginBool(plugins, "spotify", false))
	s.DiscordEnabled.Store(pluginBool(plugins, "discord", false))
	return s
}

func pluginBool(m map[string]interface{}, key string, def bool) bool {
	v, ok := m[key]
	if !ok || v == nil {
		return def
	}
	b, ok := v.(bool)
	if !ok {
		return def
	}
	return b
}

// ListenAndServe binds 127.0.0.1 (and best-effort ::1).
func (s *Server) ListenAndServe() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/local/ws-token", s.handleWSToken)
	mux.HandleFunc("/callback", s.handleSpotifyCallbackStub)
	mux.HandleFunc("/authorization", s.handleAuthorizationStub)
	mux.HandleFunc("/", s.handleRoot)

	addr := "127.0.0.1:" + itoa(s.Port)
	log.Printf("[hub] WebSocket server listening on %s", addr)

	go s.heartbeatLoop()

	go func() {
		v6 := "[::1]:" + itoa(s.Port)
		if err := http.ListenAndServe(v6, mux); err != nil {
			log.Printf("[hub] IPv6 listen skipped: %v", err)
		}
	}()

	return http.ListenAndServe(addr, mux)
}

func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	if websocket.IsWebSocketUpgrade(r) {
		s.handleWS(w, r)
		return
	}
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/plain")
	_, _ = w.Write([]byte("crimsons-server ok\n"))
}

func (s *Server) handleWSToken(w http.ResponseWriter, r *http.Request) {
	if IsRemoteWebOrigin(r.Header.Get("Origin")) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	token := auth.CurrentToken()
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if token == "" {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte(token))
}

func (s *Server) handleSpotifyCallbackStub(w http.ResponseWriter, r *http.Request) {
	body := `<html><body style='background:#111;color:white;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;'><div style='text-align:center'><h1>Spotify (Go sidecar)</h1><p>Module Spotify en cours de portage — callback reçu.</p></div></body></html>`
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(body))
	_ = r
}

func (s *Server) handleAuthorizationStub(w http.ResponseWriter, r *http.Request) {
	if IsRemoteWebOrigin(r.Header.Get("Origin")) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusServiceUnavailable)
	_, _ = w.Write([]byte(`{"error":"spotify_not_ported_yet"}`))
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token != "" {
		if dec, err := url.QueryUnescape(token); err == nil {
			token = dec
		}
	}
	if !auth.Verify(token) {
		if auth.StrictMode() {
			log.Printf("[WS] connexion refusee, jeton absent ou invalide")
			http.Error(w, "Invalid token", http.StatusForbidden)
			return
		}
		log.Printf("[WS] connexion sans jeton valide acceptee (mode non strict)")
	}

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WS] upgrade failed: %v", err)
		return
	}
	log.Printf("[WS] New client connection accepted")

	c := &client{conn: conn, send: make(chan []byte, 64)}
	s.clientsMu.Lock()
	s.clients[c] = struct{}{}
	s.clientsMu.Unlock()

	go s.writePump(c)
	s.pushInitialState(c)

	defer func() {
		s.clientsMu.Lock()
		delete(s.clients, c)
		s.clientsMu.Unlock()
		close(c.send)
		_ = conn.Close()
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			if !websocket.IsCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) && !strings.Contains(err.Error(), "EOF") {
				log.Printf("[WS] read: %v", err)
			}
			return
		}
		s.dispatch(c, data)
	}
}

func (s *Server) writePump(c *client) {
	for msg := range c.send {
		_ = c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			log.Printf("[WS] write: %v", err)
			return
		}
	}
}

func (s *Server) enqueue(c *client, msg map[string]interface{}) {
	raw, err := json.Marshal(msg)
	if err != nil {
		return
	}
	select {
	case c.send <- raw:
	default:
		log.Printf("[WS] send buffer full, dropping message type=%v", msg["type"])
	}
}

func (s *Server) pushInitialState(c *client) {
	data := storage.Load()
	s.enqueue(c, map[string]interface{}{
		"type":    "AUTO_ACCEPT_STATE",
		"enabled": data.AutoAccept,
	})
	s.enqueue(c, map[string]interface{}{
		"type":       "AUTO_BAN_STATE",
		"championId": data.EffectiveAutoBan(),
	})
	s.enqueue(c, map[string]interface{}{
		"type":       "AUTO_PICK_STATE",
		"championId": data.EffectiveAutoPick(),
	})
	s.enqueue(c, s.heartbeatPayload())
	s.enqueue(c, s.pluginPrefsPayload(data))

	if access, refresh, ok := auth.ExportedTokens(); ok {
		s.enqueue(c, map[string]interface{}{
			"type":          "AUTH_SESSION_UPDATED",
			"access_token":  access,
			"refresh_token": refresh,
		})
	}
}

func (s *Server) heartbeatPayload() map[string]interface{} {
	return map[string]interface{}{
		"type":    "HEARTBEAT_STATUS",
		"server":  true,
		"lol":     s.LolEnabled.Load() && s.LolConnected.Load(),
		"discord": s.DiscordEnabled.Load() && s.DiscordConnected.Load(),
	}
}

func (s *Server) pluginPrefsPayload(data storage.AppData) map[string]interface{} {
	plugins := storage.PluginsMap(data)
	return map[string]interface{}{
		"type":            "PLUGIN_PREFS",
		"plugins":         plugins,
		"premium":         auth.IsPremium(),
		"spotify_enabled": s.SpotifyEnabled.Load(),
		"discord_enabled": s.DiscordEnabled.Load(),
		"lol_enabled":     s.LolEnabled.Load(),
	}
}

func (s *Server) heartbeatLoop() {
	t := time.NewTicker(5 * time.Second)
	defer t.Stop()
	for range t.C {
		s.Broadcast(s.heartbeatPayload())
	}
}

// Broadcast sends a JSON object to every connected WS client.
func (s *Server) Broadcast(msg map[string]interface{}) {
	s.clientsMu.RLock()
	defer s.clientsMu.RUnlock()
	for c := range s.clients {
		s.enqueue(c, msg)
	}
}

func (s *Server) dispatch(c *client, data []byte) {
	var value map[string]interface{}
	if err := json.Unmarshal(data, &value); err != nil {
		return
	}
	typ, _ := value["type"].(string)
	switch typ {
	case "GET_VERSION":
		s.enqueue(c, map[string]interface{}{
			"type":    "SERVER_VERSION",
			"version": version.Version,
		})
	case "AUTH_SESSION":
		access, _ := value["access_token"].(string)
		if access != "" {
			var refresh *string
			if r, ok := value["refresh_token"].(string); ok && r != "" {
				refresh = &r
			}
			auth.SetSession(access, refresh)
			go auth.RefreshPremiumVerdict()
		}
	case "AUTH_SESSION_GET":
		if access, refresh, ok := auth.ExportedTokens(); ok {
			s.enqueue(c, map[string]interface{}{
				"type":          "AUTH_SESSION_UPDATED",
				"access_token":  access,
				"refresh_token": refresh,
			})
		}
	case "AUTH_LOGOUT":
		auth.ClearSession()
	case "SYNC_STATE":
		data := storage.Load()
		s.enqueue(c, s.pluginPrefsPayload(data))
	case "TOGGLE_PLUGIN":
		s.handleTogglePlugin(c, value)
	case "SET_AUTO_ACCEPT", "TOGGLE_AUTO_ACCEPT":
		s.handleAutoAccept(c, value, typ)
	case "AUTO_BAN_STATE", "TOGGLE_AUTO_BAN":
		s.handleChampToggle(c, value, "autoBan", "AUTO_BAN_STATE")
	case "AUTO_PICK_STATE", "TOGGLE_AUTO_PICK":
		s.handleChampToggle(c, value, "autoPick", "AUTO_PICK_STATE")
	case "SPOTIFY_COMMAND", "SPOTIFY_AUTH", "SPOTIFY_CREDENTIALS":
		s.enqueue(c, map[string]interface{}{
			"type":    "FEATURE_UNAVAILABLE",
			"feature": "spotify",
			"message": "Spotify module not yet ported to Go sidecar",
		})
	case "DISCORD_COMMAND":
		s.enqueue(c, map[string]interface{}{
			"type":    "FEATURE_UNAVAILABLE",
			"feature": "discord",
			"message": "Discord module not yet ported to Go sidecar",
		})
	case "HUE_COMMAND", "TWITCH_COMMAND":
		s.enqueue(c, map[string]interface{}{
			"type":    "FEATURE_UNAVAILABLE",
			"feature": strings.TrimSuffix(strings.ToLower(typ), "_command"),
		})
	case "DEBUG_LOG", "UPDATE_RESOURCE_MODE", "REGISTER_STREAMDOCK", "REGISTER_STREAMDOCK_BRIDGE", "FORWARD_TO_STREAMDOCK":
		// acknowledged / ignored in skeleton
	case "DODGE_GAME", "INJECT_BUILD", "RUNE_BUILDS_READY":
		s.enqueue(c, map[string]interface{}{
			"type":   "COMMAND_ACK",
			"action": typ,
			"ok":     false,
			"error":  "lol_not_ported_yet",
		})
	default:
		// ignore unknown for forward-compat
	}
}

func (s *Server) handleTogglePlugin(c *client, value map[string]interface{}) {
	plugin, _ := value["plugin"].(string)
	enabled, _ := value["enabled"].(bool)
	data := storage.Load()
	if data.Other == nil {
		data.Other = map[string]interface{}{}
	}
	plugins := storage.PluginsMap(data)
	if plugins == nil {
		plugins = map[string]interface{}{}
	}
	plugins[plugin] = enabled
	data.Other["plugins"] = plugins
	_ = storage.Save(data)

	switch plugin {
	case "leagueOfLegends":
		s.LolEnabled.Store(enabled)
		if !enabled {
			s.enqueue(c, map[string]interface{}{"type": "GAME_PHASE", "phase": "None"})
			s.enqueue(c, map[string]interface{}{"type": "CHAMP_SELECT", "championId": 0, "championName": ""})
			s.enqueue(c, map[string]interface{}{"type": "SUMMONER_INFO", "gameName": "", "profileIconId": 0})
		}
	case "spotify":
		s.SpotifyEnabled.Store(enabled)
		if !enabled {
			s.enqueue(c, map[string]interface{}{"type": "SPOTIFY_STATE", "data": map[string]interface{}{}})
		}
	case "discord":
		s.DiscordEnabled.Store(enabled)
		if !enabled {
			s.enqueue(c, map[string]interface{}{"type": "DISCORD_STATE", "data": map[string]interface{}{}})
		}
	}
	s.enqueue(c, s.heartbeatPayload())
	s.enqueue(c, s.pluginPrefsPayload(data))
}

func (s *Server) handleAutoAccept(c *client, value map[string]interface{}, typ string) {
	data := storage.Load()
	if typ == "TOGGLE_AUTO_ACCEPT" {
		data.AutoAccept = !data.AutoAccept
	} else if en, ok := value["enabled"].(bool); ok {
		data.AutoAccept = en
	}
	s.AutoAcceptEnabled.Store(data.AutoAccept)
	_ = storage.Save(data)
	s.enqueue(c, map[string]interface{}{"type": "AUTO_ACCEPT_STATE", "enabled": data.AutoAccept})
	if typ == "TOGGLE_AUTO_ACCEPT" {
		s.enqueue(c, map[string]interface{}{"type": "COMMAND_ACK", "action": typ, "ok": true})
	}
}

func (s *Server) handleChampToggle(c *client, value map[string]interface{}, field, outType string) {
	data := storage.Load()
	var id uint64
	switch v := value["championId"].(type) {
	case float64:
		id = uint64(v)
	}
	if data.Other == nil {
		data.Other = map[string]interface{}{}
	}
	if id == 0 {
		data.Other[field] = nil
		if field == "autoBan" {
			data.AutoBan = nil
		} else {
			data.AutoPick = nil
		}
	} else {
		data.Other[field] = id
		if field == "autoBan" {
			data.AutoBan = &id
		} else {
			data.AutoPick = &id
		}
	}
	_ = storage.Save(data)
	s.enqueue(c, map[string]interface{}{"type": outType, "championId": id})
}

func itoa(n uint16) string {
	if n == 0 {
		return "0"
	}
	var buf [5]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
