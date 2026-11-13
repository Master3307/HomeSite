import { pbkdf2Sync, randomBytes } from "node:crypto";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { accountApiProxy } from "./scripts/account-api-proxy.mjs";
import { previewCacheHeaders } from "./scripts/preview-cache-headers.mjs";

const ADMIN_KEY_ITERATIONS = 600_000;

/*
 * Lets the admin code work in the browser when the account API is offline
 * (src/lib/localAdmin.js). Only a salted PBKDF2 hash of ADMIN_KEY is
 * embedded, never the key itself; the format is "salt:iterations:hash".
 */
function adminKeyVerifier(adminKey) {
  if (!adminKey || adminKey.length < 16) return "";

  const salt = randomBytes(16);
  const hash = pbkdf2Sync(adminKey, salt, ADMIN_KEY_ITERATIONS, 32, "sha256");

  return `${salt.toString("base64")}:${ADMIN_KEY_ITERATIONS}:${hash.toString("base64")}`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      react(),
      // Long caching for hashed assets, never cache a missing one (preview).
      previewCacheHeaders(),
      // /account-api on the site's own origin (dev + preview), so admin-key
      // logins and FDC uploads also work on localhost or a LAN server.
      accountApiProxy({
        targets: (
          env.ACCOUNT_API_PROXY_TARGETS ||
          `http://127.0.0.1:${env.ACCOUNT_API_PORT || 3002},https://accounts-api.master3307.org`
        )
          .split(",")
          .map((target) => target.trim())
          .filter(Boolean),
        frontendOrigin: env.FRONTEND_ORIGIN || "http://localhost:5173",
      }),
    ],
    base: "/",
    define: {
      "import.meta.env.VITE_ADMIN_KEY_VERIFIER": JSON.stringify(
        adminKeyVerifier(env.ADMIN_KEY),
      ),
    },
    server: {
      host: true,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:3001",
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: 8081,
      strictPort: true,
      allowedHosts: ["home.master3307.org"],
    },
  };
});
