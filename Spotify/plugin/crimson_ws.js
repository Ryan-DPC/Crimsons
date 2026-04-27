class CrimsonAPI {
    constructor() {
        this.url = 'ws://127.0.0.1:40510';
        this.ws = null;
        this.queue = [];
        this.onMessageHandlers = [];
        this.connect();
    }

    connect() {
        console.log("CrimsonAPI: Attempting connection to " + this.url);
        this.ws = new WebSocket(this.url);
        
        this.ws.onopen = () => {
            console.log("CrimsonAPI: Connected to Crimson Server.");
            while (this.queue.length > 0) {
                this.ws.send(JSON.stringify(this.queue.shift()));
            }
        };

        this.ws.onmessage = (evt) => {
            try {
                const data = JSON.parse(evt.data);
                this.onMessageHandlers.forEach(h => h(data));
            } catch (e) {
                console.error("CrimsonAPI: Error parsing message", e);
            }
        };

        this.ws.onclose = () => {
            console.warn("CrimsonAPI: Connection lost. Retrying in 3s...");
            setTimeout(() => this.connect(), 3000);
        };

        this.ws.onerror = (err) => {
            console.error("CrimsonAPI: Socket error", err);
        };
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
            console.log("CrimsonAPI: Queuing message (socket not ready)");
            this.queue.push(data);
        }
    }

    onMessage(handler) {
        this.onMessageHandlers.push(handler);
    }
}

// Global instance for the whole plugin
window.crimsonAPI = new CrimsonAPI();
