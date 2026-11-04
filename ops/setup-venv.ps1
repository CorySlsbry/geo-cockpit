# setup-venv.ps1 - (re)create the self-contained backend venv with all deps.
# The 24/7 scheduled task AND the desktop app run the backend from server\.venv, because the pip
# --user site-packages (AppData\Roaming) aren't visible in a scheduled-task / restricted context.
# The venv is the reliable interpreter. Re-run this after moving the repo or upgrading Python.
$ErrorActionPreference = "Stop"
$ops = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path (Split-Path -Parent $ops) "server"
$venv = Join-Path $server ".venv"

$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\python.exe" }
if (-not (Test-Path $py)) { Write-Error "Python 3.13 not found"; exit 1 }

Write-Host "Creating venv at $venv ..."
& $py -m venv $venv
$vpy = Join-Path $venv "Scripts\python.exe"
& $vpy -m pip install -q --upgrade pip
# Backend + engine deps. citation_check uses only stdlib urllib, so no provider SDKs are needed.
& $vpy -m pip install -q fastapi uvicorn psutil PyJWT cryptography jinja2 anthropic

Write-Host "Verifying the app imports in the venv ..."
Push-Location $server
& $vpy -c "import app.main; print('venv OK -', len(app.main.app.routes), 'routes')"
Pop-Location
Write-Host "Done. The GEO-Cockpit task + desktop app will use $vpy"
