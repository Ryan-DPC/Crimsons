package hub

import "testing"

func TestIsLocalOrigin(t *testing.T) {
	ok := []string{
		"file://",
		"file:///C:/Users/x/plugin/index.html",
		"http://tauri.localhost",
		"https://tauri.localhost",
		"tauri://localhost",
		"http://localhost:5173",
		"http://127.0.0.1:40510",
		"http://[::1]:8080",
	}
	for _, o := range ok {
		if !IsLocalOrigin(o) {
			t.Errorf("expected local: %q", o)
		}
	}
	bad := []string{
		"null",
		"https://evil.com",
		"http://example.org:8080",
		"https://localhost.evil.com",
		"https://evil.com/localhost",
	}
	for _, o := range bad {
		if IsLocalOrigin(o) {
			t.Errorf("expected remote: %q", o)
		}
	}
}

func TestIsRemoteWebOrigin(t *testing.T) {
	if !IsRemoteWebOrigin("https://evil.com") {
		t.Fatal("evil should be remote")
	}
	if IsRemoteWebOrigin("file://") {
		t.Fatal("file should not be remote web")
	}
	if IsRemoteWebOrigin("null") {
		t.Fatal("null should not be remote web")
	}
	if IsRemoteWebOrigin("") {
		t.Fatal("empty should not be remote web")
	}
	if IsRemoteWebOrigin("http://127.0.0.1:40510") {
		t.Fatal("loopback should not be remote web")
	}
}
