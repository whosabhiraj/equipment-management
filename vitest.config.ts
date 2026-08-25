import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import path from "node:path";

export default defineWorkersConfig({
  resolve: {
    alias: {
      // better-auth's drizzle adapter statically imports `kysely`. Inside
      // workerd the package's `default` export condition resolves to the CJS
      // build, which blows up with "does not provide an export named 'Kysely'".
      // Pin it to the ESM build.
      kysely: path.resolve(__dirname, "node_modules/kysely/dist/esm/index.js"),
      "~": path.resolve(__dirname, "./src"),
    },
  },
  ssr: {
    // Force Vite to transform better-auth (and its kysely import) instead of
    // letting workerd's fallback resolver pick kysely's CJS build.
    noExternal: ["better-auth", "kysely"],
  },
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
    // Set up global timeout
    testTimeout: 10000,
  },
});
