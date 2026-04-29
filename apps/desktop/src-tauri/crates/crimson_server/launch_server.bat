@echo off
REM Crimson Server Launcher
REM This script can be used to start the Crimson Server from command line
REM It finds the server executable and launches it detached from the console

setlocal enabledelayedexpansion

REM Define possible paths
set "paths[0]=%APPDATA%\..\Local\crimson\bin\crimson-server.exe"
set "paths[1]=%ProgramFiles%\crimson\bin\crimson-server.exe"
set "paths[2]=%~dp0crimson-server.exe"
set "paths[3]=%~dp0bin\crimson-server.exe"

REM Try to find the executable
set "found=0"
for /l %%i in (0,1,3) do (
    if exist "!paths[%%i]!" (
        set "exe_path=!paths[%%i]!"
        set "found=1"
        goto :found
    )
)

if !found! equ 0 (
    echo Error: crimson-server.exe not found in any known path
    echo Checked:
    for /l %%i in (0,1,3) do (
        echo   - !paths[%%i]!
    )
    exit /b 1
)

:found
echo Found Crimson Server at: !exe_path!
echo Launching...

REM Launch detached (similar to the Rust code)
start "" /d "%~dp0" /b "!exe_path!"

echo Crimson Server started successfully
echo Server should be accessible at ws://127.0.0.1:40510
exit /b 0
