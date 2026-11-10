package storage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDataDirAndRoundTrip(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("APPDATA", dir)
	cacheMu.Lock()
	cached = nil
	cachePath = ""
	cacheMu.Unlock()

	d := DefaultAppData()
	d.AutoAccept = false
	id := uint64(99)
	d.AutoBan = &id
	d.Other = map[string]interface{}{"plugins": map[string]interface{}{"spotify": true}}
	if err := Save(d); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "com.laoy.crimsons", "data.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}

	cacheMu.Lock()
	cached = nil
	cachePath = ""
	cacheMu.Unlock()

	loaded := Load()
	if loaded.AutoAccept {
		t.Fatal("autoAccept should be false")
	}
	if loaded.EffectiveAutoBan() != 99 {
		t.Fatalf("autoBan=%d", loaded.EffectiveAutoBan())
	}
	plugins := PluginsMap(loaded)
	if plugins["spotify"] != true {
		t.Fatalf("plugins=%v", plugins)
	}
}
