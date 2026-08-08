param(
    # Pack de base : LoL (Crimsons) + Spotify uniquement.
    # Discord et autres plugins optionnels : -IncludeDiscord / -Extra
    [switch]$IncludeDiscord,
    [string[]]$Extra = @()
)

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$pluginSource = Join-Path $ProjectRoot "plugins\streamdeck"
$optionalSource = Join-Path $pluginSource "optional"
$pluginDest = "$env:APPDATA\HotSpot\StreamDock\plugins"

# Plugins livrés / injectés par défaut
$plugins = @(
    "com.laoy.streamdock.crimson.sdPlugin",
    "com.laoy.streamdock.spotify.sdPlugin"
)

if ($IncludeDiscord) {
    $plugins += "com.laoy.streamdock.discord.sdPlugin"
}

foreach ($extra in $Extra) {
    if ($extra -and ($plugins -notcontains $extra)) {
        $plugins += $extra
    }
}

Write-Host "Starting plugin injection (base = LoL + Spotify)..." -ForegroundColor Cyan

foreach ($plugin in $plugins) {
    $src = Join-Path $pluginSource $plugin
    if (-not (Test-Path $src)) {
        $src = Join-Path $optionalSource $plugin
    }
    $dst = Join-Path $pluginDest $plugin

    if (Test-Path $src) {
        Write-Host "Injecting $plugin..." -ForegroundColor Green
        if (Test-Path $dst) {
            Remove-Item -Recurse -Force $dst
        }
        Copy-Item -Recurse -Force $src $dst
    } else {
        Write-Host "Warning: Source $plugin not found in $pluginSource or optional/" -ForegroundColor Yellow
    }
}

Write-Host "Plugin injection complete!" -ForegroundColor Cyan
Write-Host "Tip: .\scripts\inject_plugins.ps1 -IncludeDiscord" -ForegroundColor DarkGray
Write-Host "Hue/Twitch stubs live under plugins/streamdeck/optional/ (not shipped by default)." -ForegroundColor DarkGray
Write-Host "Please restart StreamDock to apply changes." -ForegroundColor Yellow
