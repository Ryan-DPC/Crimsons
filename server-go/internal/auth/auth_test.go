package auth

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGenerateAndVerifyToken(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("APPDATA", dir)
	tok := GenerateAndSaveToken()
	if tok == "" {
		t.Fatal("empty token")
	}
	path := filepath.Join(dir, "com.laoy.crimsons", "auth.token")
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != tok {
		t.Fatalf("disk mismatch: %q vs %q", b, tok)
	}
	if !Verify(tok) {
		t.Fatal("verify failed for valid token")
	}
	if Verify("wrong-token-value-xxxxxxxx") {
		t.Fatal("verify should fail for wrong token")
	}
}

func TestStrictModeDefault(t *testing.T) {
	t.Setenv("CRIMSON_STRICT_AUTH", "")
	if !StrictMode() {
		t.Fatal("default should be strict")
	}
	t.Setenv("CRIMSON_STRICT_AUTH", "0")
	if StrictMode() {
		t.Fatal("0 should disable strict")
	}
}
