import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// ...
// In development, /api calls are forwarded to FastAPI on port 8000,
// so the browser never needs to deal with CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
