class StreamDeckUI {
    constructor() {
        this.socket = null;
    }

    setSocket(socket) {
        this.socket = socket;
    }

    setState(context, state) {
        this.send({ 
            "event": "setState", "context": context, "payload": { "state": state } 
        });
    }

    setTitle(context, title) {
        this.send({ 
            "event": "setTitle", "context": context, "payload": { "title": title, "target": 0 } 
        });
    }

    setPayload(context, title, value, image) {
        this.send({ 
            "event": "setPayload", "context": context, "payload": { "title": title, "value": value, "image": image } 
        });
    }

    setImage(context, image) {
        this.send({ 
            "event": "setImage", "context": context, "payload": { "image": image, "target": 0 } 
        });
    }

    saveSettings(context, settings) {
        this.send({ 
            "event": "setSettings", "context": context, "payload": settings 
        });
    }

    send(data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(data));
        } else if (window.api) {
            window.api.send({
                type: "FORWARD_TO_STREAMDOCK",
                payload: data
            });
        }
    }
}
const ui = new StreamDeckUI();
