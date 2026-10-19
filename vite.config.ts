import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import inject from "@rollup/plugin-inject";
import commonjs from "@rollup/plugin-commonjs";
import { savedOrdersPlugin } from "./server/saved-orders";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isDevelopment = mode === "development";

  return {
    base: "./",
    plugins: [
      vue(),
      // Saved orders in saved-orders.json next to package.json
      savedOrdersPlugin(fileURLToPath(new URL(".", import.meta.url))),
      isDevelopment && commonjs(),
      isDevelopment &&
        inject({ Buffer: ["buffer", "Buffer"], process: "process" }),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "balm-ui-plus": "balm-ui/dist/balm-ui-plus.esm.js",
        "balm-ui-css": "balm-ui/dist/balm-ui.css",
        process: "process/browser",
      },
    },
    optimizeDeps: {
      esbuildOptions: {
        define: {
          global: "globalThis",
        },
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      assetsDir: "assets",
      rollupOptions: {
        plugins: [inject({ Buffer: ["buffer", "Buffer"], process: "process" })],
        output: {
          manualChunks: undefined,
        },
      },
      commonjsOptions: {},
    },
    define: {
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: true,
    },
  };
});
