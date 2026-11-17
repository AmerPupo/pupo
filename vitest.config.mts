import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The admin routes import "@/lib/...", the same alias as tsconfig.json.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
