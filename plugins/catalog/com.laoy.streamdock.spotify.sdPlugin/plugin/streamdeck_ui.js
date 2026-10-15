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

    send(data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(data));
        } else if (window.crimsonAPI) {
            window.crimsonAPI.send({
                type: "FORWARD_TO_STREAMDOCK",
                payload: data
            });
        }
    }
}
const ui = new StreamDeckUI();
