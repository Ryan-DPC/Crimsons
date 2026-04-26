class CrimsonAPI {
    constructor() {
        this.url = 'ws://127.0.0.1:40510';
        this.ws = null;
        this.queue = [];
        this.attempts = 0;
        this.connect();
    }

    connect() {
        this.attempts++;
        this.ws = new WebSocket(this.url);
        
        this.ws.onopen = () => {
            console.log("CrimsonAPI: Connected to Backend.");
            this.attempts = 0;
            // Flush queue
            while (this.queue.length > 0) {
                const msg = this.queue.shift();
                this.ws.send(JSON.stringify(msg));
            }
        };

        this.ws.onmessage = (evt) => {
            try {
                const data = JSON.parse(evt.data);
                if (window.handleCrimsonMessage) {
                    window.handleCrimsonMessage(data);
                }
            } catch (e) {
                console.error("CrimsonAPI: Error parsing message", e);
            }
        };

        this.ws.onclose = () => {
            console.warn("CrimsonAPI: Connection closed. Reconnecting...");
            setTimeout(() => this.connect(), 2000);
        };

        this.ws.onerror = (err) => {
            console.error("CrimsonAPI: Socket error", err);
        };
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
            console.log("CrimsonAPI: Socket not open. Queuing message.");
            this.queue.push(data);
        }
    }
}

const api = new CrimsonAPI();
