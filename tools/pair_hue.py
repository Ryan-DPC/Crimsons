import urllib.request
import json
import time

BRIDGE_IP = "192.168.1.3"
print(f"=== Appairage Philips Hue ({BRIDGE_IP}) ===")
print("Veuillez appuyer sur le gros bouton rond au centre de votre pont Philips Hue...")

for i in range(30):
    try:
        req = urllib.request.Request(
            f"http://{BRIDGE_IP}/api",
            data=json.dumps({"devicetype": "crimsons#streamdock"}).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, list) and len(data) > 0:
                if "success" in data[0] and "username" in data[0]["success"]:
                    username = data[0]["success"]["username"]
                    print(f"\n[SUCCÈS] Pont appairé avec succès !")
                    print(f"Token utilisateur : {username}")
                    
                    # Save to local file so StreamDock plugin can also pick it up
                    import os
                    appdata = os.environ.get("APPDATA", "")
                    target_dir = os.path.join(appdata, "HotSpot", "StreamDock", "plugins", "com.laoy.streamdock.hue.sdPlugin")
                    if os.path.exists(target_dir):
                        with open(os.path.join(target_dir, "hue_token.json"), "w", encoding="utf-8") as f:
                            json.dump({"username": username, "bridge_ip": BRIDGE_IP}, f)
                    break
                elif "error" in data[0]:
                    print(".", end="", flush=True)
    except Exception as e:
        print("x", end="", flush=True)
    time.sleep(1)
print("\nFin.")
