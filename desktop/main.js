/**
 * main.js — GEO Cockpit desktop launcher (Electron main process).
 *
 * Responsibilities (all privileged work lives here; the renderer is a plain web app):
 *   1. Mint a random per-launch local token and start the FastAPI backend HIDDEN (no console),
 *      passing the token as COCKPIT_LOCAL_TOKEN. Idempotent: if the backend already answers
 *      /api/health (e.g. running as a service) we connect instead of spawning a second copy.
 *   2. Inject that same token as the `X-Cockpit-Local` header on EVERY request the app makes to
 *      127.0.0.1:8791 (page loads, fetch, EventSource, the report iframe) via
 *      session.defaultSession.webRequest.onBeforeSendHeaders — this is what authenticates the
 *      desktop shell to the backend as the owner.
 *   3. Show a frameless splash with live steps, confirm the Claude connection from /api/system,
 *      then open the main cockpit window.
 *   4. Tray: minimise-to-tray keeps the backend alive (so remote access still works); Quit stops it.
 *   5. Clean shutdown: kill the spawned backend process tree on quit (only if WE spawned it).
 */
"use strict";

const {
  app, BrowserWindow, Tray, Menu, ipcMain, session, nativeImage, shell,
} = require("electron");
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");

// --- constants --------------------------------------------------------------
const APP_ID = "com.neuronhq.geocockpit";
const HOST = "127.0.0.1";
const PORT = 8791;
const BASE = `http://${HOST}:${PORT}`;
const BRAND_BG = "#0C0A14";

// Random hex token, minted once per app launch. Handed to the backend as COCKPIT_LOCAL_TOKEN
// and injected as X-Cockpit-Local on every local request. Never persisted, never logged.
const LOCAL_TOKEN = crypto.randomBytes(32).toString("hex");

// --- module state -----------------------------------------------------------
let mainWindow = null;
let splashWindow = null;
let tray = null;
let backendChild = null;   // the spawned ChildProcess (null when we did not spawn)
let backendPid = null;     // its pid (tracked for taskkill fallback)
let spawnedByUs = false;   // true only if THIS app started the backend
let isQuitting = false;
let splashReady = false;
let startupRunning = false;
const statusLog = [];      // buffered status events, replayed once the splash finishes loading

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- path resolution --------------------------------------------------------

/** First path in the list that exists on disk (or null). */
function firstExisting(paths) {
  for (const p of paths) {
    try { if (p && fs.existsSync(p)) return p; } catch (_) { /* ignore */ }
  }
  return null;
}

/** Resolve an executable via `where` (Windows), returning the first real hit. */
function whereExe(name) {
  try {
    const r = spawnSync("where", [name], { windowsHide: true, encoding: "utf8" });
    if (r.status === 0 && r.stdout) {
      const line = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      if (line && fs.existsSync(line)) return line;
    }
  } catch (_) { /* ignore */ }
  return null;
}

/**
 * Locate the server directory (contains app/main.py). Works both in dev (`npm start`, where the
 * desktop app sits beside ../server) and when packaged (falls back to the known install path).
 */
function resolveServerDir() {
  const candidates = [
    process.env.COCKPIT_SERVER_DIR,
    path.resolve(__dirname, "..", "server"),
    path.resolve(process.cwd(), "..", "server"),
    "C:\\Users\\you\\Downloads\\geo-cockpit\\server",
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(path.join(c, "app", "main.py"))) return c; } catch (_) { /* ignore */ }
  }
  return "C:\\Users\\you\\Downloads\\geo-cockpit\\server"; // last-resort known path
}

/**
 * Resolve a Python interpreter, preferring pythonw.exe (which never allocates a console window).
 * Falls back to python.exe (spawned with windowsHide) and then to common per-user install paths.
 */
function resolvePython() {
  // Prefer the project venv (self-contained deps under server/.venv). The pip --user site-packages
  // aren't visible in some restricted contexts, so the venv is the reliable interpreter. windowsHide
  // on spawn suppresses python.exe's console.
  const venv = firstExisting([
    path.join(SERVER_DIR, ".venv", "Scripts", "python.exe"),
    path.join(SERVER_DIR, ".venv", "Scripts", "pythonw.exe"),
  ]);
  if (venv) return venv;
  const la = process.env.LOCALAPPDATA || "";
  const wCommon = [
    path.join(la, "Programs", "Python", "Python313", "pythonw.exe"),
    path.join(la, "Programs", "Python", "Python312", "pythonw.exe"),
    path.join(la, "Programs", "Python", "Python311", "pythonw.exe"),
  ];
  let exe = whereExe("pythonw") || firstExisting(wCommon);
  if (exe) return exe;
  const pCommon = wCommon.map((p) => p.replace("pythonw.exe", "python.exe"));
  exe = whereExe("python") || firstExisting(pCommon);
  return exe; // may be null -> caller reports the error
}

const SERVER_DIR = resolveServerDir();

// --- backend probes (main process; header set explicitly) -------------------

function probeHealth(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: HOST, port: PORT, path: "/api/health", timeout: timeoutMs,
        headers: { "X-Cockpit-Local": LOCAL_TOKEN } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const j = JSON.parse(data);
            resolve(res.statusCode === 200 && j && j.ok === true);
          } catch (_) { resolve(false); }
        });
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

function probeSystem(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: HOST, port: PORT, path: "/api/system", timeout: timeoutMs,
        headers: { "X-Cockpit-Local": LOCAL_TOKEN } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode !== 200) { resolve(null); return; }
          try { resolve(JSON.parse(data)); } catch (_) { resolve(null); }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

async function waitForHealth(timeoutMs = 30000, intervalMs = 500) {
  const start = Date.now();
  // Loop until the health endpoint answers true or we run out of time.
  // eslint-disable-next-line no-constant-condition
  while (Date.now() - start < timeoutMs) {
    if (await probeHealth(1500)) return true;
    await sleep(intervalMs);
  }
  return false;
}

// --- backend spawn / kill ---------------------------------------------------

function spawnBackend() {
  const exe = resolvePython();
  if (!exe) {
    throw new Error("Python not found. Install Python 3.13 (pythonw.exe) and retry.");
  }
  const args = [
    "-m", "uvicorn", "app.main:app",
    "--host", HOST, "--port", String(PORT),
    "--app-dir", SERVER_DIR,
  ];
  // Never set COCKPIT_DEV — the desktop path must exercise the real local-token auth check.
  const env = { ...process.env, COCKPIT_LOCAL_TOKEN: LOCAL_TOKEN };
  delete env.COCKPIT_DEV;

  backendChild = spawn(exe, args, {
    cwd: SERVER_DIR,
    windowsHide: true,   // no console window
    detached: false,     // tie lifetime to this app
    stdio: "ignore",     // nothing to read/write; no pipes
    env,
  });
  backendPid = backendChild.pid;
  spawnedByUs = true;

  backendChild.on("exit", (code) => {
    if (!isQuitting) {
      // Backend died on its own; drop our handle so a later Restart can respawn cleanly.
      backendChild = null;
      backendPid = null;
      spawnedByUs = false;
    }
  });
  backendChild.on("error", () => { /* surfaced via failed health polling */ });
  return backendChild;
}

function killBackend() {
  if (!spawnedByUs || !backendPid) return;
  const pid = backendPid;
  // Reliable on Windows: kill the whole tree so uvicorn actually stops.
  try { spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }); } catch (_) { /* ignore */ }
  try { if (backendChild && !backendChild.killed) backendChild.kill(); } catch (_) { /* ignore */ }
  backendChild = null;
  backendPid = null;
  spawnedByUs = false;
}

// --- header injection (renderer requests) -----------------------------------

/**
 * Attach X-Cockpit-Local to every request the app makes to the local backend. This is what
 * authenticates fetch/EventSource/iframe/page-load traffic from the renderer as the owner.
 * Remote (tunnelled) requests never carry it, so Cloudflare Access still gates those.
 */
function installHeaderInjection() {
  const filter = { urls: [`http://${HOST}:${PORT}/*`, `http://localhost:${PORT}/*`] };
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const requestHeaders = { ...details.requestHeaders, "X-Cockpit-Local": LOCAL_TOKEN };
    callback({ requestHeaders });
  });
}

// --- splash status plumbing -------------------------------------------------

function pushStatus(evt) {
  statusLog.push(evt);
  if (splashReady && splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send("cockpit:status", evt);
  }
}

// --- icon -------------------------------------------------------------------

function loadBrandIcon() {
  const p = path.join(__dirname, "build", "icon.png");
  try {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    }
  } catch (_) { /* ignore */ }
  return null; // Tray falls back to a 1px transparent image if missing (still functional)
}

// --- windows ----------------------------------------------------------------

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 300,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    show: false,
    backgroundColor: BRAND_BG,
    skipTaskbar: false,
    title: "GEO Cockpit",
    icon: loadBrandIcon() || undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.once("ready-to-show", () => splashWindow.show());
  splashWindow.webContents.on("did-finish-load", () => {
    splashReady = true;
    for (const e of statusLog) splashWindow.webContents.send("cockpit:status", e);
  });
  splashWindow.on("closed", () => { splashWindow = null; });
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: BRAND_BG,
    title: "GEO Cockpit",
    autoHideMenuBar: true,
    icon: loadBrandIcon() || undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(`${BASE}/`);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
    closeSplash();
  });

  // Closing the window hides to tray (keeps the backend + remote access alive) instead of quitting.
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => { mainWindow = null; });

  // Open any external (non-local) links in the system browser, not inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(BASE)) { shell.openExternal(url); return { action: "deny" }; }
    return { action: "allow" };
  });
}

function showMain() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  // Startup may still be running (no main window yet); surface the splash instead.
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.show();
    splashWindow.focus();
  }
}

// --- tray -------------------------------------------------------------------

function createTray() {
  let icon = loadBrandIcon();
  if (!icon) {
    // 1x1 transparent PNG fallback so Tray always has a valid (if invisible) image.
    icon = nativeImage.createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    );
  }
  tray = new Tray(icon);
  tray.setToolTip("GEO Cockpit");
  const menu = Menu.buildFromTemplate([
    { label: "Open GEO Cockpit", click: () => showMain() },
    { label: "Restart backend", click: () => { restartBackend(); } },
    { type: "separator" },
    { label: "Quit", click: () => quitApp() },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => showMain());
  tray.on("double-click", () => showMain());
}

// --- orchestration ----------------------------------------------------------

async function startup() {
  if (startupRunning) return;
  startupRunning = true;

  if (!splashWindow || splashWindow.isDestroyed()) createSplash();

  pushStatus({ step: "server", state: "busy", text: "Starting server…" });

  // (2) Idempotent start: connect to an already-running backend instead of spawning a second one.
  let healthy = await probeHealth(1500);
  if (healthy) {
    pushStatus({ step: "server", state: "busy", text: "Server already running — connecting…", reused: true });
  } else {
    try {
      spawnBackend();
      pushStatus({ step: "server", state: "busy", text: "Launching backend (hidden)…" });
    } catch (err) {
      pushStatus({ step: "server", state: "error", text: String(err && err.message ? err.message : err) });
      startupRunning = false;
      return; // splash shows Retry / Quit
    }
    healthy = await waitForHealth(30000);
  }

  if (!healthy) {
    pushStatus({ step: "server", state: "error", text: "Backend did not respond within 30s." });
    startupRunning = false;
    return;
  }
  pushStatus({ step: "server", state: "ok", text: "Server online", server_ok: true });

  // (3) Confirm the Claude connection from /api/system (authenticated via the injected header).
  // Cold Claude-CLI detection on a freshly spawned backend takes a few seconds, so allow generous
  // headroom — the spinner covers the wait and this is a one-time startup confirmation.
  pushStatus({ step: "claude", state: "busy", text: "Confirming Claude connection…" });
  const sys = await probeSystem(15000);
  if (sys) {
    const claudeOk = !!sys.claude_ok;
    pushStatus({
      step: "claude",
      state: claudeOk ? "ok" : "warn",
      text: claudeOk
        ? "Claude: Max subscription ✓"
        : "Claude not logged in — run `claude /login` in a terminal",
      claude_ok: claudeOk,
      battery: sys.battery || null,
      server_ok: true,
    });
  } else {
    pushStatus({
      step: "claude",
      state: "warn",
      text: "Could not read system status — continuing…",
      server_ok: true,
    });
  }

  // (4) Brief success beat, then open the cockpit and close the splash.
  await sleep(1400);
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  else { mainWindow.show(); mainWindow.focus(); closeSplash(); }

  startupRunning = false;
}

async function restartBackend() {
  killBackend();
  await sleep(700);
  if (!(await probeHealth(1000))) {
    try { spawnBackend(); } catch (_) { /* health polling will reflect failure */ }
    await waitForHealth(30000);
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
}

function quitApp() {
  isQuitting = true;
  killBackend();
  app.quit();
}

// --- app lifecycle ----------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showMain());

  app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID);
    installHeaderInjection();
    createTray();
    startup();
  });

  // Keep the app alive when all windows are hidden/closed — the tray owns the lifecycle.
  app.on("window-all-closed", () => { /* no-op: stay resident in the tray */ });

  app.on("before-quit", () => { isQuitting = true; killBackend(); });
  app.on("will-quit", () => { killBackend(); });
}

// --- IPC from the splash ----------------------------------------------------

ipcMain.on("cockpit:action", (_e, action) => {
  if (action === "retry") startup();
  else if (action === "continue") {
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
    else { mainWindow.show(); mainWindow.focus(); closeSplash(); }
  } else if (action === "quit") quitApp();
});
