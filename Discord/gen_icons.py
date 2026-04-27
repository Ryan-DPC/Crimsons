import base64
import os

images = {
    "icon@2x.png": "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAZSURBVGhD7cExAQAAAMKg9U9tCy8gAAAA4KUMgAAB6hFfkwAAAABJRU5ErkJggg==",
    "crimson.png": "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAZSURBVFhH7cExAQAAAMKg9U9tCy8gAAAA4KUMwAAB1H6Z1AAAAABJRU5ErkJggg==",
    "crimson_off.png": "iVBORw0KGgoAAAANSUhEUgAAAJYAAACWCAYAAAAr3/kYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAYSURBVHhe7cExAQAAAMKg9U9tCj+gAAAAwG0qWwABs11wCAAAAABJRU5ErkJggg==",
    "crimson_on.png": "iVBORw0KGgoAAAANSUhEUgAAAJYAAACWCAYAAAAr3/kYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAYSURBVHhe7cExAQAAAMKg9U9tCj+gAAAAwG0qWwABs11wCAAAAABJRU5ErkJggg=="
}

base_dir = r"c:\Users\ryand\AppData\Roaming\HotSpot\StreamDock\plugins\com.mirabox.streamdock.crimson.sdPlugin\static\icon"
for name, b64 in images.items():
    path = os.path.join(base_dir, name)
    with open(path, "wb") as f:
        f.write(base64.b64decode(b64))

print("Created images!")
