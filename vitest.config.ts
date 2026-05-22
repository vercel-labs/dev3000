import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "www")
    }
  },
  test: {
    exclude: ["**/node_modules/**", "**/.git/**", "www/deepsec/**"]
  }
})
