import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "apps/web",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 3210,
    strictPort: true,
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:3210; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    },
    proxy: { "/api": "http://127.0.0.1:3211" },
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    reportCompressedSize: false,
  },
});
