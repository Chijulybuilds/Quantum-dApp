import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// BASE_PATH is set when deploying to GitHub Pages (e.g. /Quantum-dApp/).
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The relayer API in development: no CORS, same origin.
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true } },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1600,
  },
});
