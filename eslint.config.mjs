import { defineConfig } from "eslint/config";
import next from "eslint-config-next";

export default defineConfig([
  {
    ignores: [
      "public/sw.js",
      "public/sw.js.map",
      "public/swe-worker-*.js",
      "public/swe-worker-*.js.map",
    ],
  },
  {
    extends: [...next],
  },
]);
