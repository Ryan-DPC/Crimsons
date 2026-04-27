class StreamDeckUI {
    constructor() {
        this.socket = null;
    }

    setSocket(socket) {
        this.socket = socket;
    }

    setState(context, state) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ 
                "event": "setState", "context": context, "payload": { "state": state } 
            }));
        }
    }

    setTitle(context, title) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ 
                "event": "setTitle", "context": context, "payload": { "title": title, "target": 0 } 
            }));
        }
    }

    setPayload(context, title, value, image) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ 
                "event": "setPayload", "context": context, "payload": { "title": title, "value": value, "image": image } 
            }));
        }
    }
}
const ui = new StreamDeckUI();
