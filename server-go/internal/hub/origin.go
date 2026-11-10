package hub

import (
	"strings"
)

// IsLocalOrigin mirrors server/src/ws.rs — Tauri webview, Vite, StreamDock file://.
func IsLocalOrigin(origin string) bool {
	lower := strings.ToLower(strings.TrimSpace(origin))
	if lower == "file://" || strings.HasPrefix(lower, "file:") {
		return true
	}

	host := origin
	if i := strings.Index(origin, "://"); i >= 0 {
		host = origin[i+3:]
	}
	if j := strings.Index(host, "/"); j >= 0 {
		host = host[:j]
	}
	// Strip port without breaking IPv6 in brackets.
	if i := strings.LastIndex(host, ":"); i >= 0 && !strings.Contains(host[i:], "]") {
		host = host[:i]
	}
	host = strings.TrimSuffix(strings.ToLower(host), ".")

	return host == "localhost" ||
		host == "127.0.0.1" ||
		host == "[::1]" ||
		host == "::1" ||
		strings.HasSuffix(host, ".localhost")
}

// IsRemoteWebOrigin is true for non-local browser origins.
// file://, null, and missing Origin stay allowed (StreamDock HTML).
func IsRemoteWebOrigin(origin string) bool {
	t := strings.TrimSpace(origin)
	if t == "" {
		return false
	}
	lower := strings.ToLower(t)
	if lower == "null" || lower == "file://" || strings.HasPrefix(lower, "file:") {
		return false
	}
	return !IsLocalOrigin(t)
}

func headerValue(rawRequest, name string) string {
	lowerName := strings.ToLower(name) + ":"
	for _, line := range strings.Split(rawRequest, "\r\n") {
		if strings.HasPrefix(strings.ToLower(line), lowerName) {
			return strings.TrimSpace(line[len(name)+1:])
		}
	}
	return ""
}

func rejectRemoteWeb(rawRequest string) bool {
	return IsRemoteWebOrigin(headerValue(rawRequest, "Origin"))
}
