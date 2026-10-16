class CrimsonAPI {
    constructor(port = 40510) {
        this.url = `ws://127.0.0.1:${port}`;
        this.ws = null;
        this.onMessage = null;
        this.onStatusChange = null;
        this.reconnectInterval = 1000;
        this.maxReconnectInterval = 5000; // Cap at 5s — no more 30s dead-air
        this.isConnected = false;
        this.attempts = 0;
        this._reconnectTimer = null;
        this.connect();
    }

    connect() {
        // Cancel any pending reconnect timer before starting a new attempt
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        this.attempts++;
        console.log(`CrimsonAPI: Connecting to ${this.url} (Attempt ${this.attempts})...`);
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
            console.log("CrimsonAPI: Connected to Backend.");
            if (this.onOpen) { this.onOpen(); }
            this.reconnectInterval = 1000; // Reset backoff on success
            this.attempts = 0;
            this.isConnected = true;
            if (this.onStatusChange) this.onStatusChange(true);
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (this.onMessage) this.onMessage(data);
            } catch (e) {
                console.error("Crimson WS Payload Parsing Error", e);
            }
        };

        this.ws.onclose = () => {
            console.warn(`CrimsonAPI: Connection lost. Reconnecting in ${this.reconnectInterval / 1000}s...`);
            this.isConnected = false;
            if (this.onStatusChange) this.onStatusChange(false);
            this._reconnectTimer = setTimeout(() => {
                this.reconnectInterval = Math.min(this.reconnectInterval * 2, this.maxReconnectInterval);
                this.connect();
            }, this.reconnectInterval);
        };

        this.ws.onerror = () => {
            this.ws.close();
        };
    }

    // Force an immediate reconnect (e.g. from infoboard tap button)
    forceReconnect() {
        this.reconnectInterval = 1000; // Reset backoff
        if (this.ws) {
            this.ws.onclose = null; // Suppress the normal close handler to avoid double-reconnect
            this.ws.close();
        }
        this.isConnected = false;
        this.connect();
    }

    send(command) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(command));
        } else {
            console.warn("Crimson Backend disconnected, command dropped:", command);
        }
    }
}

// Instantiate global API for all Crimson services (40510)
const api = new CrimsonAPI(40510);
// spotifyApi is aliased to api for backward compatibility
const spotifyApi = api;

