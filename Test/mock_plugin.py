import asyncio
import websockets
import json
import logging

# Configuration
# This script simulates the "Handover" process where a client (like the UI) 
# tells the server to connect to a specific port where a "Hardware" is listening.
MOCK_HARDWARE_PORT = 40511
WS_URL = "ws://127.0.0.1:40510"

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger("MockPlugin")

async def mock_hardware_server():
    """Simulates the WebSocket server that the Crimson Server connects to during Handover."""
    async def handler(websocket, path):
        logger.info("Crimson Server CONNECTED to Mock Hardware.")
        try:
            async for message in websocket:
                data = json.loads(message)
                logger.info(f"Hardware Received: {data.get('event')}")
                
                # Auto-acknowledge registration
                if data.get("event") == "registerStreamDock":
                    logger.info("Registration Successful.")
                
        except Exception as e:
            logger.error(f"Hardware Error: {e}")

    logger.info(f"Starting Mock Hardware Server on ws://127.0.0.1:{MOCK_HARDWARE_PORT}...")
    server = await websockets.serve(handler, "127.0.0.1", MOCK_HARDWARE_PORT)
    return server

async def trigger_handover():
    """Simulates the Crimson UI triggering a handover to the Mock Hardware."""
    await asyncio.sleep(2) # Wait for server to start
    logger.info(f"Connecting to Crimson Server to trigger handover...")
    async with websockets.connect(WS_URL) as ws:
        payload = {
            "type": "REGISTER_STREAMDOCK",
            "port": MOCK_HARDWARE_PORT,
            "uuid": "MOCK-DEVICE-ID",
            "register_event": "registerStreamDock"
        }
        await ws.send(json.dumps(payload))
        logger.info("Handover trigger sent.")
        
        # Wait for ACK
        msg = await ws.recv()
        logger.info(f"UI Received ACK: {msg}")

async def main():
    server = await mock_hardware_server()
    await trigger_handover()
    await asyncio.Future() # run forever

if __name__ == "__main__":
    asyncio.run(main())
