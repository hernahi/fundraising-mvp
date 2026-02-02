// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// -----------------------------------------------
//  PRODUCTION-GRADE VITE CONFIG
//  • Optimized chunking
//  • Strong cache control
//  • CSP-compatible file hashing
//  • Firebase Hosting alignment
//  • HTTP/2 preload friendly
// -----------------------------------------------

export default defineConfig({
  plugins: [
    react({
      jsxImportSource: "@emotion/react",
      babel: {
        plugins: [
          // Add your JSX/React hardening transforms here if needed
        ],
      },
    }),
  ],

  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },

  server: {
    port: 5173,
    strictPort: true,
  },

  preview: {
    port: 4173,
    strictPort: true,
  },

  build: {
    outDir: "dist",
    emptyOutDir: true,

    // ---------------------------------------------
    //  Asset Output Hardening
    // ---------------------------------------------
    sourcemap: false,          // Disable source maps for production security
    target: "es2020",
    minify: "esbuild",

    // ---------------------------------------------
    //  CSP-friendly filenames with hashing
    // ---------------------------------------------
    assetsDir: "assets",
    manifest: true,
    cssCodeSplit: true,

    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].[hash].js",
        chunkFileNames: "assets/[name].[hash].js",
        assetFileNames: "assets/[name].[hash].[ext]",

        // ---------------------------------------------------------
        //  Manual chunking for faster reload & caching
        // ---------------------------------------------------------
        manualChunks: {
          react: ["react", "react-dom"],
          firebase: [
            "firebase/app",
            "firebase/auth",
            "firebase/firestore",
            "firebase/storage",
          ],
        },
      },
    },
  },

  // ---------------------------------------------
  //  Security: prevent unwanted dependencies
  // ---------------------------------------------
  optimizeDeps: {
    include: ["firebase/app", "firebase/auth", "firebase/firestore"],
    exclude: ["@firebase/rules-unit-testing"],
  },
});
