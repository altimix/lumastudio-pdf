import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5193,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:5194" },
    watch: {
      ignored: [
        "**/release/**",
        "**/tmp/**",
        "**/playwright-report/**",
        "**/test-results/**",
      ],
    },
    fs: {
      deny: [
        ".env",
        ".env.*",
        "**/*.{p12,pfx,pem,key}",
        "**/.git/**",
        "**/tmp/**",
        "**/release/**",
      ],
    },
  },
  build: { chunkSizeWarningLimit: 1600 },
});
