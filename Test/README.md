# Crimson Automated Test Suite

This folder contains tools for automated testing and debugging of the Crimson Server and its plugins.

## Contents

- `automated_tests.py`: Main test script that simulates WebSocket interactions with the server.
- `test_log.log`: Detailed log of the last test execution.

## How to Run

1. Ensure the **Crimson Server** is running (via Tauri or by running the `crimson-server.exe` manually).
2. Open a terminal in this folder.
3. Run the following command:
   ```bash
   python automated_tests.py
   ```
4. Check the console output or `test_log.log` for results.

## Test Coverage

- **Heartbeat Status**: Verifies the server broadcasts its status (Server, LoL, Discord) on connection.
- **Handover Registration**: Verifies that the server acknowledges a StreamDock registration request.
- **Command Routing**: Verifies that Spotify/Discord commands are accepted by the server.

## Debugging

If a test fails, look for `[ERROR]` or `[WARNING]` in `test_log.log`. You can also add more test cases to `automated_tests.py` to target specific components.
