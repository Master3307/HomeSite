import { existsSync } from "node:fs";
import path from "node:path";

/*
 * Cache headers for `vite preview`, which serves the live site through
 * Cloudflare (temp-server).
 *
 * - /assets/* files have content hashes in their names: cache them for a
 *   year. A missing one (e.g. requested while `pnpm build` is rewriting
 *   dist/) gets a 404 marked no-store, so Cloudflare never caches the miss.
 * - Everything else (index.html, JSON data, …) must be revalidated.
 */
export function previewCacheHeaders({ outDir = "dist" } = {}) {
  return {
    name: "preview-cache-headers",
    configurePreviewServer(server) {
      const root = path.resolve(server.config.root, outDir);

      server.middlewares.use((req, res, next) => {
        const pathname = decodeURIComponent((req.url ?? "").split("?")[0]);

        if (pathname.startsWith("/assets/")) {
          const file = path.join(root, pathname);

          if (!file.startsWith(root + path.sep) || !existsSync(file)) {
            res.statusCode = 404;
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            return res.end("Not found");
          }

          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "no-cache");
        }

        return next();
      });
    },
  };
}
