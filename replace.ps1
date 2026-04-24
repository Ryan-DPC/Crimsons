$p = "C:\Users\Chino\AppData\Roaming\HotSpot\StreamDock\plugins\com.mirabox.streamdock.spotify.sdPlugin\plugin\index.js"
$c = Get-Content -Raw $p
$c = $c -replace 'plugin\.showOk\(', '(function(){})('
Set-Content -Path $p -Value $c
