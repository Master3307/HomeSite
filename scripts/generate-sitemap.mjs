import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { Sitemap } from "@mongez/sitemap";
import settings from "../config/settings.cjs";

// The site's address comes from FRONTEND_ORIGIN (.env).
const SITE_URL = settings.resolve(process.env, "FRONTEND_ORIGIN").replace(/\/+$/, "");
const sitemap = new Sitemap(SITE_URL);
const today = new Date().toISOString();

const routes = [
  { path: "/", priority: 1.0 },
  { path: "/card", priority: 0.9 },
  { path: "/about", priority: 0.8 },
  { path: "/license", priority: 0.3 },
  { path: "/maps", priority: 0.7 },
  { path: "/cult", priority: 0.8 },
  { path: "/cult/birthdays", priority: 0.4 },
  { path: "/privacy", priority: 0.3 },
  { path: "/search", priority: 0.5 },
];

for (const route of routes) {
  sitemap.add({
    ...route,
    lastModified: today,
  });
}

await sitemap.saveTo("./public/sitemap.xml");
await writeFile("./public/robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);