param(
    # Plus de pack de base : lister explicitement les packages du catalogue.
    # Ex. -Plugins com.laoy.streamdock.crimson.sdPlugin,com.laoy.streamdock.spotify.sdPlugin
    [Parameter(Mandatory = $true)]
    [string[]]$Plugins
)

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$pluginSource = Join-Path $ProjectRoot "plugins\catalog"
$pluginDest = "$env:APPDATA\HotSpot\StreamDock\plugins"

if (-not $Plugins -or $Plugins.Count -eq 0) {
    Write-Host "Erreur: aucun plugin. Utiliser -Plugins <id.sdPlugin>[,...]" -ForegroundColor Red
    Write-Host "Catalogue: $pluginSource\catalog.json" -ForegroundColor DarkGray
    exit 1
}

Write-Host "Injecting catalog plugins (no base pack)..." -ForegroundColor Cyan

foreach ($plugin in $Plugins) {
    if (-not $plugin) { continue }
    $src = Join-Path $pluginSource $plugin
    $dst = Join-Path $pluginDest $plugin

    if (Test-Path $src) {
        Write-Host "Injecting $plugin..." -ForegroundColor Green
        if (Test-Path $dst) {
            Remove-Item -Recurse -Force $dst
        }
        Copy-Item -Recurse -Force $src $dst
    } else {
        Write-Host "Warning: Source $plugin not found in $pluginSource" -ForegroundColor Yellow
    }
}

Write-Host "Plugin injection complete!" -ForegroundColor Cyan
Write-Host "Please restart StreamDock to apply changes." -ForegroundColor Yellow
