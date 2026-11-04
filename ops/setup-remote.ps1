# setup-remote.ps1 — one-time: expose the GEO Cockpit at https://geo.neuron-hq.com via a named
# Cloudflare tunnel. Run this in a NORMAL PowerShell (a browser step needs you). neuron-hq.com is
# already on Cloudflare, so `route dns` works automatically (no nameserver move).
#
#   powershell -ExecutionPolicy Bypass -File ops\setup-remote.ps1
#
# After it finishes, create the Cloudflare Access application (see NEEDS-CORY.md) so only your login
# can reach it, then paste the AUD tag + team domain into server\cockpit.config.json.

$ErrorActionPreference = "Stop"
$cf = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
if (-not (Test-Path $cf)) {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { $cf = $cmd.Source } else { Write-Error "cloudflared not found. winget install Cloudflare.cloudflared"; exit 1 }
}
$cfgDir = Join-Path $env:USERPROFILE ".cloudflared"
New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null

Write-Host "`n[1/5] Authorizing cloudflared (a browser window will open — pick the neuron-hq.com zone)..." -ForegroundColor Cyan
& $cf tunnel login

Write-Host "`n[2/5] Creating the named tunnel 'geo-cockpit'..." -ForegroundColor Cyan
& $cf tunnel create geo-cockpit
$credFile = Get-ChildItem $cfgDir -Filter *.json | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $credFile) { Write-Error "no tunnel credentials file was written"; exit 1 }
$uuid = [System.IO.Path]::GetFileNameWithoutExtension($credFile.Name)
Write-Host "    tunnel UUID: $uuid"

Write-Host "`n[3/5] Writing $cfgDir\config.yml..." -ForegroundColor Cyan
@"
tunnel: $uuid
credentials-file: $($credFile.FullName)

ingress:
  - hostname: geo.neuron-hq.com
    service: http://127.0.0.1:8791
  - service: http_status:404
"@ | Out-File -Encoding ascii (Join-Path $cfgDir "config.yml")

Write-Host "`n[4/5] Routing geo.neuron-hq.com -> this tunnel (DNS on Cloudflare, automatic)..." -ForegroundColor Cyan
& $cf tunnel route dns geo-cockpit geo.neuron-hq.com

Write-Host "`n[5/5] Optional: install as an always-up Windows service (needs elevation)." -ForegroundColor Cyan
Write-Host "    Run this in an ADMIN PowerShell for 24/7 remote access even when the desktop app is closed:" -ForegroundColor DarkGray
Write-Host "      & `"$cf`" --config `"$cfgDir\config.yml`" service install" -ForegroundColor Yellow
Write-Host "    (Skip it if you prefer the desktop app to manage the tunnel while it's open.)`n" -ForegroundColor DarkGray

Write-Host "Smoke test (leave the cockpit backend running on 127.0.0.1:8791):" -ForegroundColor Green
Write-Host "  & `"$cf`" tunnel run geo-cockpit   ->   then open https://geo.neuron-hq.com`n"
Write-Host "NEXT: create the Cloudflare Access app + policy (NEEDS-CORY.md) so only your login gets in." -ForegroundColor Green
