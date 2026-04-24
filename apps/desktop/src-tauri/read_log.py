with open(r'C:\Users\Chino\AppData\Roaming\Crimson\streamdock.log', 'rb') as f:
    f.seek(0, 2)
    filesize = f.tell()
    offset = min(filesize, 5000)
    f.seek(filesize - offset)
    content = f.read().decode('utf-8', errors='ignore')
    for line in content.splitlines():
        if '[RAW]' in line and 'Playback' not in line:
            print(line)
