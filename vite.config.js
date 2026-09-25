import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// The landing page, privacy/terms and icons are plain files in public/ (copied as-is);
// only the notes app at /edit/ goes through the build.
export default defineConfig({
  plugins: [preact()],
  build: {
    rollupOptions: { input: "edit/index.html" }
  },
  server: { port: 5173, strictPort: true }
});
