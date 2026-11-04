# launch_backend.ps1 - start the GEO Cockpit backend hidden on 127.0.0.1:8791 (idempotent).
# Pure ASCII, PS 5.1 safe. If 8791 already listens, do nothing. Uses pythonw (no console).
$ErrorActionPreference = "Continue"
$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8791

$listening = $null
try { $listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | Select-Object -First 1 } catch {}
if ($null -ne $listening) { exit 0 }

# Prefer the project venv (reliable deps); fall back to system pythonw/python.
$pyw = $null
$venv = Join-Path $base ".venv\Scripts\python.exe"
if (Test-Path $venv) { $pyw = $venv }
if (-not $pyw) { try { $pyw = (Get-Command pythonw -ErrorAction Stop).Source } catch {} }
if (-not $pyw) { try { $pyw = (Get-Command python -ErrorAction Stop).Source } catch {} }
if (-not $pyw) { exit 1 }

Start-Process -FilePath $pyw `
  -ArgumentList "-m","uvicorn","app.main:app","--host","127.0.0.1","--port","$port" `
  -WorkingDirectory $base -WindowStyle Hidden
exit 0
