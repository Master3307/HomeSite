import { Sitemap } from "@mongez/sitemap";

const sitemap = new Sitemap("https://home.master3307.org");
const today = new Date().toISOString();

const routes = [
  { path: "/", priority: 1.0 },
  { path: "/card", priority: 0.7 },
  { path: "/about", priority: 0.6 },
];

for (const route of routes) {
  sitemap.add({
    ...route,
    lastModified: today,
  });
}

await sitemap.saveTo("./public/sitemap.xml");