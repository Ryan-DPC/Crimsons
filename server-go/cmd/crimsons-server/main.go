package main

import (
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"

	"github.com/Ryan-DPC/Crimsons/server-go/internal/auth"
	"github.com/Ryan-DPC/Crimsons/server-go/internal/hub"
	"github.com/Ryan-DPC/Crimsons/server-go/internal/storage"
	"github.com/Ryan-DPC/Crimsons/server-go/internal/version"
)

// Optional ldflags for release embeds (mirrors Rust build.rs):
//
//	-X main.embeddedSupabaseURL=...
//	-X main.embeddedSupabaseAnonKey=...
var (
	embeddedSupabaseURL     string
	embeddedSupabaseAnonKey string
)

func main() {
	setupLogging()

	// Dev builds must opt in — same guard as the Rust sidecar.
	if isDevBuild() && os.Getenv("CRIMSON_DEV") != "1" {
		msg := "Build de developpement lance hors contexte de developpement : arret. " +
			"Definissez CRIMSON_DEV=1 pour l'executer volontairement."
		_ = os.WriteFile(filepath.Join(storage.DataDir(), "panic.log"), []byte("SIDECAR REFUSED TO START: "+msg+"\n"), 0o644)
		log.Print(msg)
		return
	}

	log.Printf("--- SERVER'S STARTUP (go) v%s ---", version.Version)
	log.Printf("runtime %s/%s", runtime.GOOS, runtime.GOARCH)

	if embeddedSupabaseURL != "" || embeddedSupabaseAnonKey != "" {
		auth.SetSupabaseConfig(embeddedSupabaseURL, embeddedSupabaseAnonKey)
	}
	auth.LoadSessionFromDisk()
	_ = auth.GenerateAndSaveToken()
	log.Printf("[auth] %s", auth.ConfigSummary())

	auth.StartGuard(func(premium bool) {
		log.Printf("[entitlement] premium=%v", premium)
	})
	go auth.RefreshPremiumVerdict()

	srv := hub.New(40510)
	log.Printf("[PID %d] Starting Server (PRIMARY) on port %d...", os.Getpid(), srv.Port)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("listen: %v", err)
	}
}

func isDevBuild() bool {
	// Go has no cfg!(debug_assertions). Treat absence of release embed as dev,
	// unless CRIMSON_RELEASE=1 is set by the packaging script.
	if os.Getenv("CRIMSON_RELEASE") == "1" {
		return false
	}
	return embeddedSupabaseURL == ""
}

func setupLogging() {
	dir := storage.DataDir()
	logPath := filepath.Join(dir, "crimson-server.log")
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		log.SetFlags(log.LstdFlags | log.Lmicroseconds)
		log.Printf("log file unavailable (%v), stderr only", err)
		return
	}
	log.SetOutput(f)
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	// Also mirror to stderr for CRIMSON_DEV interactive runs.
	if os.Getenv("CRIMSON_DEV") == "1" {
		log.SetOutput(io.MultiWriter(f, os.Stderr))
	}
}
