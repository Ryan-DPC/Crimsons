# Crimson Server Autostart Management Script
# This script helps manage the Windows Task Scheduler task for Crimson Server

param(
    [ValidateSet('status', 'enable', 'disable', 'reinstall', 'test', 'logs')]
    [string]$Action = 'status'
)

function Write-Banner {
    param([string]$Message)
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host $Message -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

function Find-ServerExecutable {
    $paths = @(
        "$env:APPDATA\..\Local\crimson\bin\crimson-server.exe",
        "${env:ProgramFiles}\crimson\bin\crimson-server.exe",
        "C:\Users\$env:USERNAME\AppData\Local\crimson\bin\crimson-server.exe"
    )
    
    foreach ($path in $paths) {
        if (Test-Path $path) {
            return $path
        }
    }
    
    return $null
}

function Get-TaskStatus {
    $task = Get-ScheduledTask -TaskName "CrimsonServer" -ErrorAction SilentlyContinue
    
    if ($null -eq $task) {
        return "NOT_FOUND"
    }
    
    return $task.State
}

function Show-Status {
    Write-Banner "Crimson Server Autostart Status"
    
    $serverPath = Find-ServerExecutable
    $taskStatus = Get-TaskStatus
    
    Write-Host "Server Executable:" -ForegroundColor Green
    if ($serverPath) {
        Write-Host "  ✓ Found: $serverPath" -ForegroundColor Green
        Write-Host "  Size: $((Get-Item $serverPath).Length / 1MB)MB" -ForegroundColor Gray
    } else {
        Write-Host "  ✗ Not found in known paths" -ForegroundColor Red
    }
    
    Write-Host ""
    Write-Host "Task Scheduler:" -ForegroundColor Green
    Write-Host "  Task Name: CrimsonServer" -ForegroundColor Gray
    
    if ($taskStatus -eq "NOT_FOUND") {
        Write-Host "  Status: NOT CONFIGURED" -ForegroundColor Red
    } else {
        $statusColor = if ($taskStatus -eq "Ready") { "Green" } else { "Yellow" }
        Write-Host "  Status: $taskStatus" -ForegroundColor $statusColor
        
        $task = Get-ScheduledTask -TaskName "CrimsonServer"
        Write-Host "  Last Run: $($task.LastRunTime)" -ForegroundColor Gray
        Write-Host "  Next Run: $($task.NextRunTime)" -ForegroundColor Gray
    }
    
    # Check if port 40510 is in use
    Write-Host ""
    Write-Host "Server Port Status:" -ForegroundColor Green
    $portInUse = $null -ne (Get-NetTCPConnection -LocalPort 40510 -ErrorAction SilentlyContinue)
    if ($portInUse) {
        Write-Host "  ✓ Port 40510 is in use (server is running)" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Port 40510 is not in use (server is not running)" -ForegroundColor Yellow
    }
}

function Enable-ServerAutostart {
    Write-Banner "Enabling Crimson Server Autostart"
    
    $serverPath = Find-ServerExecutable
    if (-not $serverPath) {
        Write-Host "✗ Server executable not found!" -ForegroundColor Red
        return $false
    }
    
    Write-Host "Creating Task Scheduler task..."
    
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -LogonType Interactive -RunLevel Highest
    $action = New-ScheduledTaskAction -Execute $serverPath -WorkingDirectory (Split-Path $serverPath)
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    
    try {
        Unregister-ScheduledTask -TaskName "CrimsonServer" -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
        Register-ScheduledTask -TaskName "CrimsonServer" -Principal $principal -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
        Write-Host "✓ Task created successfully" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "✗ Failed to create task: $_" -ForegroundColor Red
        return $false
    }
}

function Disable-ServerAutostart {
    Write-Banner "Disabling Crimson Server Autostart"
    
    try {
        Unregister-ScheduledTask -TaskName "CrimsonServer" -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
        Write-Host "✓ Task removed successfully" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "✗ Failed to remove task: $_" -ForegroundColor Red
        return $false
    }
}

function Reinstall-ServerAutostart {
    Write-Banner "Reinstalling Crimson Server Autostart"
    Disable-ServerAutostart | Out-Null
    Start-Sleep -Seconds 1
    Enable-ServerAutostart
}

function Test-ServerStartup {
    Write-Banner "Testing Crimson Server Startup"
    
    $serverPath = Find-ServerExecutable
    if (-not $serverPath) {
        Write-Host "✗ Server executable not found!" -ForegroundColor Red
        return
    }
    
    Write-Host "Attempting to start server..."
    try {
        & $serverPath
        Write-Host "✓ Server launched" -ForegroundColor Green
        Start-Sleep -Seconds 2
        
        # Check if port is now in use
        $portInUse = $null -ne (Get-NetTCPConnection -LocalPort 40510 -ErrorAction SilentlyContinue)
        if ($portInUse) {
            Write-Host "✓ Server is responding on port 40510" -ForegroundColor Green
        } else {
            Write-Host "⚠ Server launched but port 40510 not responding yet" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "✗ Failed to start server: $_" -ForegroundColor Red
    }
}

function Show-Logs {
    Write-Banner "Crimson Server Event Logs"
    
    Write-Host "Recent Task Scheduler events for CrimsonServer:" -ForegroundColor Green
    Get-WinEvent -FilterHashtable @{
        LogName = "Microsoft-Windows-TaskScheduler/Operational"
        Data = "CrimsonServer"
    } -MaxEvents 20 -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "$($_.TimeCreated) - $($_.Message)" -ForegroundColor Gray
    }
}

# Execute the action
switch ($Action) {
    'status' { Show-Status }
    'enable' { Enable-ServerAutostart }
    'disable' { Disable-ServerAutostart }
    'reinstall' { Reinstall-ServerAutostart }
    'test' { Test-ServerStartup }
    'logs' { Show-Logs }
}
