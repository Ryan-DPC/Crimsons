import urllib.request
import json
import time
import os
import sys

BRIDGE_IP = "192.168.1.3"
print(f"=== Appairage Philips Hue ({BRIDGE_IP}) ===", flush=True)
print("En attente de la pression sur le gros bouton rond au centre du pont Hue...", flush=True)
print("Vous avez 6 minutes...", flush=True)

paired_user = None

for i in range(360):
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
                    paired_user = data[0]["success"]["username"]
                    print(f"\n\n[SUCCÈS ABSOLU] Pont Philips Hue appairé avec succès !", flush=True)
                    print(f"Token utilisateur généré : {paired_user}", flush=True)
                    break
                elif "error" in data[0]:
                    # Print dot every second to show it's active
                    sys.stdout.write(".")
                    sys.stdout.flush()
    except Exception as e:
        sys.stdout.write("x")
        sys.stdout.flush()
    time.sleep(1)

if not paired_user:
    print("\n[TIMEOUT] Le bouton n'a pas été pressé à temps.", flush=True)
    sys.exit(1)

# Save to APPDATA plugin folder
appdata = os.environ.get("APPDATA", "")
plugin_dir_appdata = os.path.join(appdata, "HotSpot", "StreamDock", "plugins", "com.laoy.streamdock.hue.sdPlugin")
token_data = {"username": paired_user, "bridge_ip": BRIDGE_IP}

if os.path.exists(plugin_dir_appdata):
    token_file = os.path.join(plugin_dir_appdata, "hue_token.json")
    with open(token_file, "w", encoding="utf-8") as f:
        json.dump(token_data, f, indent=2)
    print(f"Enregistré dans: {token_file}", flush=True)

    # Also update app.js directly so token is baked into memory
    app_js_path = os.path.join(plugin_dir_appdata, "plugin", "app.js")
    if os.path.exists(app_js_path):
        with open(app_js_path, "r", encoding="utf-8") as f:
            content = f.read()
        content = content.replace(
            'let hueUser = localStorage.getItem("hue_username") || "";',
            f'let hueUser = localStorage.getItem("hue_username") || "{paired_user}";'
        )
        with open(app_js_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("Token injecté en dur dans app.js (APPDATA) !", flush=True)

# Save to repo catalog folder
repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
plugin_dir_repo = os.path.join(repo_root, "plugins", "catalog", "com.laoy.streamdock.hue.sdPlugin")
if os.path.exists(plugin_dir_repo):
    token_file_repo = os.path.join(plugin_dir_repo, "hue_token.json")
    with open(token_file_repo, "w", encoding="utf-8") as f:
        json.dump(token_data, f, indent=2)
    app_js_repo = os.path.join(plugin_dir_repo, "plugin", "app.js")
    if os.path.exists(app_js_repo):
        with open(app_js_repo, "r", encoding="utf-8") as f:
            content = f.read()
        content = content.replace(
            'let hueUser = localStorage.getItem("hue_username") || "";',
            f'let hueUser = localStorage.getItem("hue_username") || "{paired_user}";'
        )
        with open(app_js_repo, "w", encoding="utf-8") as f:
            f.write(content)
        print("Token synchronisé dans le repo catalog !", flush=True)

# Fetch lights and scenes to verify
try:
    with urllib.request.urlopen(f"http://{BRIDGE_IP}/api/{paired_user}/lights", timeout=5) as resp:
        lights = json.loads(resp.read().decode("utf-8"))
        print(f"\n[LUMIÈRES DÉTECTÉES] : {len(lights)} lumière(s) trouvée(s)")
        for lid, ldata in lights.items():
            print(f"  - [{lid}] {ldata.get('name', 'Inconnu')} (État: {'ALLUMÉ' if ldata.get('state', {}).get('on') else 'ÉTEINT'})")

    with urllib.request.urlopen(f"http://{BRIDGE_IP}/api/{paired_user}/scenes", timeout=5) as resp:
        scenes = json.loads(resp.read().decode("utf-8"))
        print(f"[SCÈNES DÉTECTÉES] : {len(scenes)} scène(s) trouvée(s)")
        for sid, sdata in list(scenes.items())[:5]:
            print(f"  - Scène: {sdata.get('name', 'Inconnu')}")
except Exception as e:
    print(f"Erreur inspection Hue: {e}", flush=True)

print("\n=== Appairage terminé avec succès ! ===", flush=True)
