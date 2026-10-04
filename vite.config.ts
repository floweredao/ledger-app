import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4341,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4340" },
  },
  build: { outDir: "dist", assetsDir: "static", emptyOutDir: true },
});
