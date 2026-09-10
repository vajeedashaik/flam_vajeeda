import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Demo app config for later phases. Phase 1 only touches src/core.
export default defineConfig({
  plugins: [react()],
});
