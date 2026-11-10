package auth

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Supabase endpoints are loaded from env / crimson/.env (dev) or -ldflags (release).
// They must never come from a WS client.
var (
	supabaseURL     string
	supabaseAnonKey string
	cfgOnce         sync.Once
)

// SetSupabaseConfig injects compile-time or startup values.
func SetSupabaseConfig(url, anonKey string) {
	supabaseURL = strings.TrimSpace(url)
	supabaseAnonKey = strings.TrimSpace(anonKey)
}

func ensureConfig() {
	cfgOnce.Do(func() {
		if supabaseURL != "" && supabaseAnonKey != "" {
			return
		}
		url := firstNonEmpty(os.Getenv("CRIMSON_SUPABASE_URL"), os.Getenv("VITE_SUPABASE_URL"))
		key := firstNonEmpty(os.Getenv("CRIMSON_SUPABASE_ANON_KEY"), os.Getenv("VITE_SUPABASE_ANON_KEY"))
		if url == "" || key == "" {
			u2, k2 := readCrimsonEnv()
			if url == "" {
				url = u2
			}
			if key == "" {
				key = k2
			}
		}
		supabaseURL = url
		supabaseAnonKey = key
	})
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func readCrimsonEnv() (url, key string) {
	candidates := []string{
		filepath.Join("crimson", ".env"),
		filepath.Join("..", "crimson", ".env"),
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(dir, "..", "..", "crimson", ".env"),
			filepath.Join(dir, "crimson", ".env"),
		)
	}
	for _, p := range candidates {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		content := strings.TrimPrefix(string(b), "\ufeff")
		for _, line := range strings.Split(content, "\n") {
			line = strings.TrimSpace(line)
			k, v, ok := strings.Cut(line, "=")
			if !ok {
				continue
			}
			k, v = strings.TrimSpace(k), strings.TrimSpace(v)
			switch k {
			case "VITE_SUPABASE_URL":
				url = v
			case "VITE_SUPABASE_ANON_KEY":
				key = v
			}
		}
		if url != "" || key != "" {
			return url, key
		}
	}
	return "", ""
}

// RefreshPremiumVerdict asks Supabase for entitlements.is_premium. Fail-closed.
func RefreshPremiumVerdict() bool {
	ensureConfig()
	token := AccessToken()
	if token == "" || supabaseURL == "" || supabaseAnonKey == "" {
		SetPremium(false)
		return false
	}

	client := &http.Client{Timeout: 8 * time.Second}
	endpoint := strings.TrimRight(supabaseURL, "/") + "/rest/v1/entitlements?select=is_premium&limit=1"
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		SetPremium(false)
		return false
	}
	req.Header.Set("apikey", supabaseAnonKey)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[entitlement] request failed: %v", err)
		SetPremium(false)
		return false
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		log.Printf("[entitlement] HTTP %d: %s", resp.StatusCode, truncate(string(body), 200))
		SetPremium(false)
		return false
	}
	var rows []struct {
		IsPremium bool `json:"is_premium"`
	}
	if err := json.Unmarshal(body, &rows); err != nil {
		SetPremium(false)
		return false
	}
	ok := len(rows) > 0 && rows[0].IsPremium
	SetPremium(ok)
	return ok
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// StartGuard re-applies the premium verdict periodically (services will hook later).
func StartGuard(onChange func(premium bool)) {
	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			was := IsPremium()
			now := RefreshPremiumVerdict()
			if onChange != nil && was != now {
				onChange(now)
			}
			<-ticker.C
		}
	}()
}

// Configured reports whether Supabase endpoints are available.
func Configured() bool {
	ensureConfig()
	return supabaseURL != "" && supabaseAnonKey != ""
}

func ConfigSummary() string {
	ensureConfig()
	if !Configured() {
		return "supabase: not configured (premium denied)"
	}
	return fmt.Sprintf("supabase: %s", supabaseURL)
}
