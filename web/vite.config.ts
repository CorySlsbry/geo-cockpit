import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build to ../server-served static (web/dist). In dev, proxy /api to the FastAPI backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    proxy: {
      "/api": { target: "http://127.0.0.1:8791", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // recharts (+ d3) is the bundle's main weight and only 3 pages use it; splitting it
        // out with the react vendor pair drops the initial chunk from ~755KB to well under
        // the 300KB budget, and lazy routes mean charts load with the first page that needs them.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
        },
      },
    },
  },
});
