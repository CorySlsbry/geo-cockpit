/**
 * preload.js — minimal, safe bridge for the splash window.
 *
 * Runs in an isolated context (contextIsolation: true). Exposes only a tiny status/action API on
 * window.cockpit. The main cockpit window (the React web app served by the backend) simply ignores
 * it. No Node, no filesystem, no arbitrary IPC is exposed to page content.
 */
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cockpit", {
  /** Subscribe to startup status events from the main process. Returns an unsubscribe fn. */
  onStatus: (cb) => {
    const handler = (_event, data) => {
      try { cb(data); } catch (_) { /* ignore renderer callback errors */ }
    };
    ipcRenderer.on("cockpit:status", handler);
    return () => ipcRenderer.removeListener("cockpit:status", handler);
  },
  /** Splash buttons -> main process. Only these three actions are honoured. */
  action: (name) => {
    const allowed = new Set(["retry", "continue", "quit"]);
    const a = String(name || "");
    if (allowed.has(a)) ipcRenderer.send("cockpit:action", a);
  },
});
