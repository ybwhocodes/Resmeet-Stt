import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/",
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8200",
      "/socket.io": { target: "http://127.0.0.1:8200", ws: true },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
});
