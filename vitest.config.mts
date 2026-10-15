import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mismo alias que tsconfig.json, para probar módulos que importan "@/…".
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
});
