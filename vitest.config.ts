import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const workspaceRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": workspaceRoot,
      // Next aliases the bare "server-only" marker at build time; plain Vite does not,
      // so point it at the no-op copy Next vendors to keep server modules importable in tests.
      "server-only": fileURLToPath(new URL("./node_modules/next/dist/compiled/server-only/empty.js", import.meta.url))
    }
  },
  // Vite's automatic JSX runtime supports the project's React TSX test files.
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    passWithNoTests: true,
  },
});
