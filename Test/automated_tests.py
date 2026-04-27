import asyncio
import websockets
import json
import logging
import time
import os

# Configuration
WS_URL = "ws://127.0.0.1:40510"
TEST_LOG_PATH = "c:/Users/Chino/Documents/Crimson/Test/test_log.log"

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(TEST_LOG_PATH),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("CrimsonTest")

class CrimsonTester:
    def __init__(self):
        self.ws = None
        self.handover_ws = None
        self.uuid = "TEST-UUID-1234"
        self.port = 40511 # Simulated port for handover
        self.register_event = "registerStreamDock"

    async def connect(self):
        try:
            logger.info(f"Connecting to Crimson Server at {WS_URL}...")
            self.ws = await websockets.connect(WS_URL)
            logger.info("Connected to Crimson Server.")
            return True
        except Exception as e:
            logger.error(f"Failed to connect: {e}")
            return False

    async def wait_for_type(self, type_name, timeout=5):
        start_time = time.time()
        while time.time() - start_time < timeout:
            msg = await asyncio.wait_for(self.ws.recv(), timeout=1)
            data = json.loads(msg)
            logger.info(f"Received: {data.get('type') or data.get('event')}")
            if data.get("type") == type_name:
                return data
            if data.get("event") == type_name:
                return data
        return None

    async def test_heartbeat(self):
        logger.info("Testing Heartbeat...")
        data = await self.wait_for_type("HEARTBEAT_STATUS")
        if data:
            logger.info(f"PASS: Heartbeat received. Server: {data.get('server')}, LoL: {data.get('lol')}")
            return True
        logger.error("FAIL: Heartbeat not received.")
        return False

    async def test_handover_registration(self):
        logger.info("Testing Handover Registration...")
        reg_payload = {
            "type": "REGISTER_STREAMDOCK",
            "port": self.port,
            "uuid": self.uuid,
            "register_event": self.register_event
        }
        await self.ws.send(json.dumps(reg_payload))
        logger.info(f"Sent Handover Registration for UUID {self.uuid}")

        data = await self.wait_for_type("COMMAND_ACK")
        if data and data.get("action") == "REGISTER_STREAMDOCK":
            logger.info("PASS: Handover ACK received.")
            return True
        logger.error("FAIL: Handover ACK not received.")
        return False

    async def test_spotify_command(self):
        logger.info("Testing Spotify Command Routing (Realistic Structure)...")
        # Structure matching handleActionClick in app.js
        cmd_payload = {
            "type": "SPOTIFY_COMMAND",
            "endpoint": "play",
            "payload": {
                "uri": "spotify:playlist:37i9dQZF1DXcBWIGoYBM3M",
                "playlist": "spotify:playlist:37i9dQZF1DXcBWIGoYBM3M"
            }
        }
        await self.ws.send(json.dumps(cmd_payload))
        logger.info("Sent Spotify play playlist command.")
        
        # Check for ACK
        data = await self.wait_for_type("COMMAND_ACK")
        if data and data.get("action") == "SPOTIFY_COMMAND":
             logger.info("PASS: Spotify Command ACK received.")
             return True
        
        logger.error("FAIL: Spotify Command ACK not received.")
        return False

    async def run_all(self):
        if not await self.connect():
            return

        results = {
            "Heartbeat": await self.test_heartbeat(),
            "Handover": await self.test_handover_registration(),
            "SpotifyCmd": await self.test_spotify_command()
        }

        logger.info("--- TEST RESULTS ---")
        for test, passed in results.items():
            status = "PASS" if passed else "FAIL"
            logger.info(f"{test}: {status}")

        await self.ws.close()

if __name__ == "__main__":
    tester = CrimsonTester()
    asyncio.run(tester.run_all())
