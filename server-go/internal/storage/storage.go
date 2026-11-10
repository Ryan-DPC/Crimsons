package storage

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// AppData matches the camelCase data.json used by the UI / former Rust sidecar.
type AppData struct {
	AutoAccept          bool                   `json:"autoAccept"`
	AutoBan             *uint64                `json:"autoBan"`
	AutoPick            *uint64                `json:"autoPick"`
	RememberedAutoBan   *uint64                `json:"rememberedAutoBan"`
	RememberedAutoPick  *uint64                `json:"rememberedAutoPick"`
	SpotifyClientID     string                 `json:"spotifyClientId"`
	SpotifyClientSecret string                 `json:"spotifyClientSecret"`
	IsPremium           bool                   `json:"isPremium"`
	PremiumToken        *string                `json:"premiumToken"`
	CustomServerPath    *string                `json:"customServerPath"`
	DiscordClientID     *string                `json:"discordClientId"`
	Other               map[string]interface{} `json:"-"`
}

var (
	cacheMu   sync.RWMutex
	cached    *AppData
	cachePath string
)

func DefaultAppData() AppData {
	return AppData{
		AutoAccept: true,
		Other:      map[string]interface{}{},
	}
}

// DataDir is %APPDATA%/com.laoy.crimsons on Windows, or ./com.laoy.crimsons on Linux/dev.
func DataDir() string {
	appdata := os.Getenv("APPDATA")
	var path string
	if appdata != "" {
		path = filepath.Join(appdata, "com.laoy.crimsons")
		for _, legacy := range []string{"com.laoy.crimson", "com.laoy.crimons"} {
			legacyPath := filepath.Join(appdata, legacy)
			if st, err := os.Stat(legacyPath); err == nil && st.IsDir() {
				migrateLegacy(legacyPath, path)
			}
		}
	} else {
		cwd, _ := os.Getwd()
		path = filepath.Join(cwd, "com.laoy.crimsons")
	}
	_ = os.MkdirAll(path, 0o755)
	return path
}

func DataPath() string {
	return filepath.Join(DataDir(), "data.json")
}

func migrateLegacy(from, to string) {
	_ = os.MkdirAll(to, 0o755)
	entries, err := os.ReadDir(from)
	if err != nil {
		return
	}
	for _, e := range entries {
		src := filepath.Join(from, e.Name())
		dst := filepath.Join(to, e.Name())
		if _, err := os.Stat(dst); err == nil {
			continue
		}
		if e.IsDir() {
			_ = copyDir(src, dst)
		} else {
			_ = copyFile(src, dst)
		}
	}
}

func copyFile(src, dst string) error {
	in, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, in, 0o644)
}

func copyDir(src, dst string) error {
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		s := filepath.Join(src, e.Name())
		d := filepath.Join(dst, e.Name())
		if e.IsDir() {
			if err := copyDir(s, d); err != nil {
				return err
			}
		} else if _, err := os.Stat(d); os.IsNotExist(err) {
			if err := copyFile(s, d); err != nil {
				return err
			}
		}
	}
	return nil
}

func Load() AppData {
	path := DataPath()
	cacheMu.RLock()
	if cached != nil && cachePath == path {
		out := *cached
		cacheMu.RUnlock()
		return out
	}
	cacheMu.RUnlock()

	data := DefaultAppData()
	raw, err := os.ReadFile(path)
	if err != nil || len(raw) == 0 {
		return data
	}

	// Decode into a map first so unknown keys survive in Other.
	var generic map[string]interface{}
	if err := json.Unmarshal(raw, &generic); err != nil {
		return data
	}
	_ = json.Unmarshal(raw, &data)
	data.Other = generic
	// Remove typed keys from Other to avoid double-writes later.
	for _, k := range []string{
		"autoAccept", "autoBan", "autoPick", "rememberedAutoBan", "rememberedAutoPick",
		"spotifyClientId", "spotifyClientSecret", "isPremium", "premiumToken",
		"customServerPath", "discordClientId",
	} {
		delete(data.Other, k)
	}

	cacheMu.Lock()
	cached = &data
	cachePath = path
	cacheMu.Unlock()
	return data
}

func Save(data AppData) error {
	path := DataPath()
	_ = os.MkdirAll(filepath.Dir(path), 0o755)

	out := map[string]interface{}{}
	for k, v := range data.Other {
		out[k] = v
	}
	typed, _ := json.Marshal(data)
	var typedMap map[string]interface{}
	_ = json.Unmarshal(typed, &typedMap)
	for k, v := range typedMap {
		out[k] = v
	}
	raw, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		return err
	}
	cacheMu.Lock()
	cp := data
	cached = &cp
	cachePath = path
	cacheMu.Unlock()
	return nil
}

func (d AppData) EffectiveAutoBan() uint64 {
	if d.AutoBan != nil && *d.AutoBan > 0 {
		return *d.AutoBan
	}
	return champFromOther(d.Other, "autoBan")
}

func (d AppData) EffectiveAutoPick() uint64 {
	if d.AutoPick != nil && *d.AutoPick > 0 {
		return *d.AutoPick
	}
	return champFromOther(d.Other, "autoPick")
}

func champFromOther(other map[string]interface{}, key string) uint64 {
	if other == nil {
		return 0
	}
	v, ok := other[key]
	if !ok || v == nil {
		return 0
	}
	switch t := v.(type) {
	case float64:
		if t > 0 {
			return uint64(t)
		}
	case json.Number:
		n, _ := t.Int64()
		if n > 0 {
			return uint64(n)
		}
	case string:
		var n uint64
		_, _ = json.Number(t).Int64()
		_ = n
	}
	return 0
}

func PluginsMap(data AppData) map[string]interface{} {
	if data.Other == nil {
		return map[string]interface{}{}
	}
	if p, ok := data.Other["plugins"].(map[string]interface{}); ok {
		return p
	}
	return map[string]interface{}{}
}
