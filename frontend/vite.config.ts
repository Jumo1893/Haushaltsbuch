import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Im Dev-Modus werden /api-Aufrufe an das Backend weitergeleitet (wie nginx im Container).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": process.env.API_URL ?? "http://localhost:3000",
    },
  },
});
